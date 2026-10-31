/**
 * Mock Fix-it: builds a plan from a script (gate dry run per auto step) and runs the selected steps.
 * Pure: takes a state, returns the next state. The Go `fix_case.go` is the source of truth.
 */
import { ApiRequestError } from "../errors";
import type {
  ActionRequest,
  FixAutoStep,
  FixCapability,
  FixEvent,
  FixPlan,
  FixRunResult,
  FixStep,
  FixStepResult,
  FixToolName,
  SupportAction,
} from "../types";
import type { FixScript } from "./fix-scripts";
import {
  addAudit,
  applyAction,
  findCase,
  postReply,
  previewAction,
  type MockState,
} from "./policy";

export const FIX_MAX_STEPS = 6;

/** Same catalog as the Go `FixCapabilities()`. */
export const FIX_CAPABILITIES: FixCapability[] = [
  {
    tool: "cancelSubscription",
    actor: "customer",
    label: "Cancel subscription",
    description:
      "Cancels one active subscription of this customer on their behalf (web billing, or the simulated App Store connector for app_store subscriptions).",
    rule: "C1",
  },
  {
    tool: "sendMagicLink",
    actor: "customer",
    label: "Email a one-time login link",
    description:
      "Sends a one-time login link to the customer's own email (simulated email connector) when reset emails do not get them in.",
    rule: "E1",
  },
  {
    tool: "restoreAccess",
    actor: "support",
    label: "Restore Premium access",
    description:
      "Activates an inactive entitlement of a paid customer, backed by their latest succeeded payment.",
    rule: "R1",
  },
  {
    tool: "refundPayment",
    actor: "support",
    label: "Refund a duplicate charge",
    description:
      "Refunds one duplicate charge of $50 or less (P1 duplicate, P2 limit, P3 once).",
    rule: "P1",
  },
];

const badInput = (message: string): ApiRequestError =>
  new ApiRequestError(400, { code: "bad_request", message });

function str(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== "string" || v.trim() === "")
    throw badInput(`Step input "${key}" must be a non-empty string`);
  return v;
}

/** Maps an auto step to the gate request it stands for. */
function toRequest(step: Pick<FixAutoStep, "tool" | "input">): ActionRequest {
  const { input } = step;
  const reason = str(input, "reason");
  const action = ((): SupportAction => {
    switch (step.tool) {
      case "cancelSubscription":
        return {
          type: "cancel_subscription",
          subscriptionId: str(input, "subscriptionId"),
          reason,
        };
      case "sendMagicLink":
        return { type: "send_magic_link", reason };
      case "restoreAccess":
        return {
          type: "restore_access",
          entitlementId: str(input, "entitlementId"),
          reason,
        };
      case "refundPayment":
        return {
          type: "refund_payment",
          paymentId: str(input, "paymentId"),
          reason,
        };
    }
  })();
  return { kind: "support_action", action };
}

export function buildPlan(
  state: MockState,
  caseId: string,
  script: FixScript,
  planId: string,
  now: string,
): FixPlan {
  const steps = script.steps.map((draft, i): FixStep => {
    const id = `step_${i + 1}`;
    if (draft.kind === "manual") return { ...draft, id };
    const preview = previewAction(state, caseId, toRequest(draft), now);
    return {
      id,
      kind: "auto",
      owner: "agent",
      title: draft.title,
      detail: draft.detail,
      tool: draft.tool,
      actor: draft.actor,
      input: draft.input,
      rule: preview.rule,
      wouldBe: preview.status,
      previewMessage: preview.message,
    };
  });
  return {
    id: planId,
    caseId,
    problem: script.problem,
    summary: script.summary,
    steps,
    replyBody: script.replyBody,
    createdAt: now,
  };
}

interface Call {
  text: string;
  tool: FixToolName;
  input: object;
  output: unknown;
  ids: string[];
}

const QUEUED_NOTE = "Queued for human approval; nothing was executed.";

/** Target record id of an auto step, for evidence chips. */
function targetId(input: Record<string, unknown>): string | null {
  const v = input.subscriptionId ?? input.entitlementId ?? input.paymentId;
  return typeof v === "string" ? v : null;
}

/** One queued step per plan step, in plan order; output mirrors the Go fix tools. */
function stepCall(
  step: FixStep,
  plan: FixPlan,
  script: FixScript,
  i: number,
): Call {
  const queued = {
    queued: true,
    executed: false,
    planId: plan.id,
    stepId: step.id,
    kind: step.kind,
    note: QUEUED_NOTE,
  };
  if (step.kind === "manual")
    return {
      text: `Noting what ${step.owner === "tech" ? "the tech team" : `the ${step.owner}`} has to do.`,
      tool: "noteManualStep",
      input: { owner: step.owner, title: step.title, detail: step.detail },
      output: queued,
      ids: [],
    };
  const draft = script.steps[i];
  const target = targetId(step.input);
  return {
    text: draft.kind === "auto" ? draft.text : "",
    tool: step.tool,
    input: step.input,
    output: {
      ...queued,
      wouldBe: step.wouldBe,
      rule: step.rule,
      previewMessage: step.previewMessage,
    },
    ids: target ? [target] : [],
  };
}

/** The full fix stream in contract order: start, reads, queued writes, submitFixPlan, plan, done. */
export function fixEvents(
  caseId: string,
  script: FixScript,
  plan: FixPlan,
): FixEvent[] {
  const calls: Call[] = [
    ...script.reads.map((r) => ({ ...r, input: {} })),
    ...plan.steps.map((step, i) => stepCall(step, plan, script, i)),
    {
      text: "Submitting the fix plan for approval.",
      tool: "submitFixPlan",
      input: {
        problem: plan.problem,
        summary: plan.summary,
        replyBody: plan.replyBody,
      },
      output: { accepted: true },
      ids: [],
    },
  ];
  const steps = calls.flatMap((c, i): FixEvent[] => {
    const callId = `f${i + 1}`;
    return [
      { event: "step", data: { n: i + 1 } },
      { event: "text", data: { delta: c.text } },
      { event: "tool_call", data: { callId, tool: c.tool, input: c.input } },
      {
        event: "tool_result",
        data: { callId, tool: c.tool, output: c.output, ids: c.ids },
      },
    ];
  });
  return [
    {
      event: "start",
      data: {
        caseId,
        replay: true,
        model: "mock",
        maxSteps: FIX_MAX_STEPS,
        mode: "fix",
      },
    },
    ...steps,
    { event: "plan", data: { plan } },
    { event: "done", data: {} },
  ];
}

/** Audits every read of the run plus `fix:plan_proposed`. */
export function storePlanAudit(
  state: MockState,
  script: FixScript,
  plan: FixPlan,
): MockState {
  const caseId = plan.caseId;
  const withReads = script.reads.reduce(
    (s, r) =>
      addAudit(
        s,
        {
          caseId,
          actor: "ai",
          step: `tool:${r.tool}`,
          detail: r.ids.slice(0, 5).join(", ") || "no records",
        },
        plan.createdAt,
      ),
    state,
  );
  const manual = plan.steps.filter((s) => s.kind === "manual").length;
  return addAudit(
    withReads,
    {
      caseId,
      actor: "ai",
      step: "fix:plan_proposed",
      detail: `${plan.id} · ${plan.steps.length - manual} auto, ${manual} manual steps`,
    },
    plan.createdAt,
  );
}

/** Same checks as the Go `FixPlan.CheckSelection`: auto steps of this plan, no repeats. */
function checkSelection(plan: FixPlan, stepIds: readonly string[]): void {
  stepIds.forEach((id, i) => {
    const step = plan.steps.find((s) => s.id === id);
    if (!step) throw badInput(`Step "${id}" is not in plan ${plan.id}.`);
    if (step.kind !== "auto")
      throw badInput(`Step ${id} is a manual step; it cannot be executed.`);
    if (stepIds.indexOf(id) !== i)
      throw badInput(`Step ${id} is selected twice.`);
  });
}

interface RunOutcome {
  state: MockState;
  result: FixRunResult;
}

/**
 * Runs the selected auto steps in plan order through the gate; a block stops the run and later steps are skipped.
 * If nothing was blocked, posts `replyBody`. The case resolves only if nothing was blocked and no manual step is open.
 */
export function runPlan(
  initial: MockState,
  plan: FixPlan,
  stepIds: readonly string[],
  now: string,
): RunOutcome {
  checkSelection(plan, stepIds);
  const caseId = plan.caseId;
  let state = addAudit(
    initial,
    {
      caseId,
      actor: "support",
      step: "fix:approved",
      detail: `${plan.id} · ${stepIds.length} selected`,
    },
    now,
  );
  let stopped = false;
  const steps: FixStepResult[] = [];
  for (const step of plan.steps) {
    if (step.kind !== "auto") continue;
    if (stopped || !stepIds.includes(step.id)) {
      steps.push({ stepId: step.id, status: "skipped", result: null });
      continue;
    }
    const out = applyAction(state, caseId, toRequest(step), now);
    state = out.state;
    stopped = out.result.status === "blocked";
    steps.push({
      stepId: step.id,
      status: out.result.status,
      result: out.result,
    });
  }
  const replied = !stopped;
  if (replied) state = postReply(state, caseId, plan.replyBody, now);
  const manualOpen = plan.steps.some((s) => s.kind === "manual");
  if (!stopped && !manualOpen)
    state = applyAction(state, caseId, { kind: "mark_resolved" }, now).state;
  const resolved = findCase(state, caseId).status === "resolved";
  const executed = steps.filter((s) => s.status === "executed").length;
  state = addAudit(
    state,
    {
      caseId,
      actor: "system",
      step: stopped ? "fix:stopped" : "fix:completed",
      detail: `${plan.id} · ${executed} executed${resolved ? ", resolved" : ""}`,
    },
    now,
  );
  return {
    state,
    result: {
      planId: plan.id,
      status: stopped ? "stopped" : "executed",
      steps,
      replied,
      resolved,
    },
  };
}
