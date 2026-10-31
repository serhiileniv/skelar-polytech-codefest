/**
 * In-browser `ApiClient`: replays a scripted agent loop per case (same SSE event order as the Go API)
 * and runs actions through a copy of the policy gate. State lives in memory; a page reload resets it.
 */
import type { ApiClient } from "../client";
import { ApiRequestError } from "../errors";
import type {
  CaseDetail,
  CaseListItem,
  FixPlan,
  InvestigateEvent,
  Metrics,
  Outcome,
  Verdict,
} from "../types";
import {
  addAudit,
  applyAction,
  assertFixAllowed,
  findCase,
  findRecords,
  notFound,
  postReply,
  updateCase,
  type MockState,
} from "./policy";
import {
  FIX_CAPABILITIES,
  buildPlan,
  fixEvents,
  runPlan,
  storePlanAudit,
} from "./fix";
import { fixScriptFor } from "./fix-scripts";
import { askAnswer, assertAskable } from "./ask";
import { scriptFor, type CaseScript } from "./scripts";
import { createWorld } from "./world";

export interface MockClientOptions {
  /** Pause between stream events, ms. 0 in tests. */
  delayMs?: number;
}

const DEFAULT_DELAY_MS = 350;
const MAX_STEPS = 8;
const PREVIEW_CHARS = 120;
const OUTCOMES: readonly Outcome[] = [
  "user_can_fix",
  "support_can_fix",
  "tech_team",
  "need_more_info",
  "suspicious",
];

const initialState = (): MockState => ({
  world: createWorld(),
  board: [],
  audit: [],
  actions: { executed: 0, blocked: 0 },
  seq: 0,
});

const nowIso = (): string => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);

const abortError = (): DOMException =>
  new DOMException("Investigation aborted", "AbortError");

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    if (ms <= 0) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function toVerdict(script: CaseScript): Verdict {
  return {
    ...script.verdict,
    modelOutcome: script.verdict.outcome,
    downgraded: false,
    validationNotes: [],
    stepsUsed: script.steps.length + 1,
    createdAt: nowIso(),
  };
}

/** The full event sequence for one scripted run, in contract order. */
function scriptEvents(
  caseId: string,
  script: CaseScript,
  verdict: Verdict,
): InvestigateEvent[] {
  const start: InvestigateEvent = {
    event: "start",
    data: { caseId, replay: true, model: "mock", maxSteps: MAX_STEPS },
  };
  const toolSteps = script.steps.flatMap((s, i): InvestigateEvent[] => {
    const callId = `c${i + 1}`;
    return [
      { event: "step", data: { n: i + 1 } },
      { event: "text", data: { delta: s.text } },
      { event: "tool_call", data: { callId, tool: s.tool, input: s.input } },
      {
        event: "tool_result",
        data: { callId, tool: s.tool, output: s.output, ids: s.ids },
      },
    ];
  });
  const n = script.steps.length + 1;
  const callId = `c${n}`;
  const submit: InvestigateEvent[] = [
    { event: "step", data: { n } },
    { event: "text", data: { delta: "Submitting the verdict." } },
    {
      event: "tool_call",
      data: { callId, tool: "submitVerdict", input: script.verdict },
    },
    {
      event: "tool_result",
      data: {
        callId,
        tool: "submitVerdict",
        output: { accepted: true },
        ids: [],
      },
    },
  ];
  return [
    start,
    ...toolSteps,
    ...submit,
    { event: "verdict", data: { verdict } },
    { event: "done", data: {} },
  ];
}

/** Stores the verdict plus one audit entry per tool call, all at once (an aborted run stores nothing). */
function storeVerdict(
  state: MockState,
  caseId: string,
  script: CaseScript,
  verdict: Verdict,
): MockState {
  const at = verdict.createdAt;
  const withSteps = script.steps.reduce(
    (s, step) =>
      addAudit(
        s,
        {
          caseId,
          actor: "ai",
          step: `tool:${step.tool}`,
          detail: step.ids.slice(0, 5).join(", ") || "no records",
        },
        at,
      ),
    state,
  );
  const withVerdict = addAudit(
    withSteps,
    {
      caseId,
      actor: "ai",
      step: "verdict",
      detail: `${verdict.outcome} (${Math.round(verdict.confidence * 100)}%)`,
    },
    at,
  );
  return updateCase(withVerdict, caseId, { verdict });
}

function detailOf(state: MockState, caseId: string): CaseDetail {
  const kase = findCase(state, caseId);
  const { customer, subscriptions, payments, entitlements } = findRecords(
    state,
    kase.customerId,
  );
  const audit = state.audit.filter((a) => a.caseId === caseId);
  return clone({
    case: kase,
    customer,
    subscriptions,
    payments,
    entitlements,
    audit,
  });
}

function metricsOf(state: MockState): Metrics {
  const verdicts = state.world.cases.flatMap((c) =>
    c.verdict ? [c.verdict] : [],
  );
  const byOutcome = Object.fromEntries(
    OUTCOMES.map((o) => [o, verdicts.filter((v) => v.outcome === o).length]),
  ) as Record<Outcome, number>;
  const totalSteps = verdicts.reduce((sum, v) => sum + v.stepsUsed, 0);
  return {
    totalCases: state.world.cases.length,
    investigated: verdicts.length,
    byOutcome,
    keptFromTech: verdicts.filter((v) => v.outcome !== "tech_team").length,
    downgraded: verdicts.filter((v) => v.downgraded).length,
    avgSteps: verdicts.length
      ? Math.round((totalSteps / verdicts.length) * 10) / 10
      : 0,
    actions: { ...state.actions },
    eval: null,
  };
}

export function createMockClient({
  delayMs = DEFAULT_DELAY_MS,
}: MockClientOptions = {}): ApiClient {
  let state = initialState();
  /** Pending plan per case (in memory, like the Go plan store) and whether it was approved. */
  let plans = new Map<string, { plan: FixPlan; approved: boolean }>();
  let planSeq = 0;

  return {
    mode: "mock",

    async listCases(): Promise<CaseListItem[]> {
      return state.world.cases.map((c) => {
        const last = c.messages.at(-1)?.body ?? "";
        return {
          id: c.id,
          subject: c.subject,
          customerName: findRecords(state, c.customerId).customer.name,
          preview: last.slice(0, PREVIEW_CHARS),
          status: c.status,
          outcome: c.verdict?.outcome ?? null,
          createdAt: c.createdAt,
        };
      });
    },

    async getCase(id) {
      return detailOf(state, id);
    },

    async reply(id, body) {
      state = postReply(state, id, body, nowIso());
      return detailOf(state, id);
    },

    async action(id, req) {
      const { state: next, result } = applyAction(state, id, req, nowIso());
      state = next;
      return clone(result);
    },

    async board() {
      return clone(state.board);
    },

    async metrics() {
      return metricsOf(state);
    },

    async reset() {
      state = initialState();
      plans = new Map();
      return { reset: true };
    },

    async investigate(id, onEvent, signal) {
      const kase = findCase(state, id);
      const script = scriptFor(kase, findRecords(state, kase.customerId));
      if (!script) throw notFound(`Investigation script for ${id}`);
      const verdict = toVerdict(script);
      for (const event of scriptEvents(id, script, verdict)) {
        await sleep(event.event === "start" ? 0 : delayMs, signal);
        if (event.event === "verdict")
          state = storeVerdict(state, id, script, verdict);
        onEvent(clone(event));
      }
    },

    async ask(id, question) {
      const verdict = assertAskable(findCase(state, id), question);
      await sleep(delayMs * 2);
      return clone(askAnswer(verdict, question));
    },

    async fixCapabilities() {
      return clone(FIX_CAPABILITIES);
    },

    async fix(id, onEvent, signal) {
      const kase = findCase(state, id);
      assertFixAllowed(kase);
      const script = fixScriptFor(kase, findRecords(state, kase.customerId));
      if (!script) throw notFound(`Fix-it script for ${id}`);
      planSeq += 1;
      const plan = buildPlan(
        state,
        id,
        script,
        `plan_${String(planSeq).padStart(4, "0")}`,
        nowIso(),
      );
      for (const event of fixEvents(id, script, plan)) {
        await sleep(event.event === "start" ? 0 : delayMs, signal);
        if (event.event === "plan") {
          state = storePlanAudit(state, script, plan);
          plans = new Map(plans).set(id, { plan, approved: false });
        }
        onEvent(clone(event));
      }
    },

    async approveFix(id, planId, stepIds) {
      findCase(state, id);
      const entry = plans.get(id);
      if (!entry || entry.plan.id !== planId)
        throw notFound(`Plan ${planId} for ${id}`);
      if (entry.approved)
        throw new ApiRequestError(409, {
          code: "conflict",
          message: `Plan ${planId} was already approved`,
        });
      const out = runPlan(state, entry.plan, stepIds, nowIso());
      state = out.state;
      plans = new Map(plans).set(id, { ...entry, approved: true });
      return clone(out.result);
    },
  };
}
