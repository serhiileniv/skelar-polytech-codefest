/**
 * In-browser `ApiClient`: replays a scripted agent loop per case (same SSE event order as the Go API)
 * and runs actions through a copy of the policy gate. State lives in memory; a page reload resets it.
 */
import type { ApiClient } from "../client";
import { ApiRequestError } from "../errors";
import type {
  CaseDetail,
  CaseListItem,
  InvestigateEvent,
  Metrics,
  Outcome,
  Verdict,
} from "../types";
import {
  addAudit,
  applyAction,
  findCase,
  findRecords,
  notFound,
  updateCase,
  type MockState,
} from "./policy";
import { scriptFor, type CaseScript } from "./scripts";
import { createWorld } from "./world";

export interface MockClientOptions {
  /** Pause between stream events, ms. 0 in tests. */
  delayMs?: number;
}

const DEFAULT_DELAY_MS = 350;
const MAX_STEPS = 8;
const MAX_REPLY_CHARS = 3000;
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
        ids: verdict.evidence.map((e) => e.id),
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
      const text = body.trim();
      if (text.length < 1 || text.length > MAX_REPLY_CHARS) {
        throw new ApiRequestError(400, {
          code: "bad_request",
          message: `Reply must be 1–${MAX_REPLY_CHARS} characters`,
        });
      }
      const kase = findCase(state, id);
      const message = {
        id: `msg_s${String(state.seq + 1).padStart(4, "0")}`,
        from: "support" as const,
        body: text,
        at: nowIso(),
      };
      const status = kase.status === "open" ? "waiting_customer" : kase.status;
      const withMessage = updateCase(state, id, {
        messages: [...kase.messages, message],
        status,
      });
      state = addAudit(
        withMessage,
        {
          caseId: id,
          actor: "support",
          step: "reply",
          detail: text.slice(0, PREVIEW_CHARS),
        },
        message.at,
      );
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
  };
}
