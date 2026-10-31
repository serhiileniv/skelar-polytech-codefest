/**
 * Rough copy of the backend policy gate (the Go one is the source of truth).
 * Pure: takes a state, returns the next state + an `ActionResult`. Never mutates its input.
 */
import { ApiRequestError } from "../errors";
import type {
  ActionRequest,
  ActionResult,
  AuditEntry,
  Case,
  Signature,
  SupportAction,
  TechIssue,
} from "../types";
import {
  SILENT_CANCEL_NOT_SYNCED,
  type CustomerRecords,
  type World,
} from "./world";

/** Refunds above this need a human above support (rule P2). */
export const REFUND_LIMIT_USD = 50;

export interface MockState {
  world: World;
  board: TechIssue[];
  audit: AuditEntry[];
  actions: { executed: number; blocked: number };
  seq: number;
}

export interface Transition {
  state: MockState;
  result: ActionResult;
}

/** Other customers known to share a root cause (what `findSimilarCustomers` returns). */
const SIMILAR_BY_SIGNATURE: Partial<Record<Signature, readonly string[]>> = {
  cancel_not_synced: SILENT_CANCEL_NOT_SYNCED,
};

export const notFound = (what: string): ApiRequestError =>
  new ApiRequestError(404, { code: "not_found", message: `${what} not found` });

export function findCase(state: MockState, caseId: string): Case {
  const kase = state.world.cases.find((c) => c.id === caseId);
  if (!kase) throw notFound(`Case ${caseId}`);
  return kase;
}

export function findRecords(
  state: MockState,
  customerId: string,
): CustomerRecords {
  const records = state.world.customers.find(
    (r) => r.customer.id === customerId,
  );
  if (!records) throw notFound(`Customer ${customerId}`);
  return records;
}

export const updateCase = (
  state: MockState,
  caseId: string,
  patch: Partial<Case>,
): MockState => ({
  ...state,
  world: {
    ...state.world,
    cases: state.world.cases.map((c) =>
      c.id === caseId ? { ...c, ...patch } : c,
    ),
  },
});

const updateRecords = (
  state: MockState,
  customerId: string,
  fn: (r: CustomerRecords) => CustomerRecords,
): MockState => ({
  ...state,
  world: {
    ...state.world,
    customers: state.world.customers.map((r) =>
      r.customer.id === customerId ? fn(r) : r,
    ),
  },
});

/** Appends one audit entry; ids are `aud_0001`, `aud_0002`, … */
export function addAudit(
  state: MockState,
  entry: Omit<AuditEntry, "id" | "at">,
  at: string,
): MockState {
  const seq = state.seq + 1;
  const id = `aud_${String(seq).padStart(4, "0")}`;
  return { ...state, seq, audit: [...state.audit, { ...entry, id, at }] };
}

const blocked = (message: string, rule: string): ActionResult => ({
  status: "blocked",
  message,
  rule,
});
const executed = (
  message: string,
  rule: string,
  techIssue?: TechIssue,
): ActionResult =>
  techIssue
    ? { status: "executed", message, rule, techIssue }
    : { status: "executed", message, rule };

const actionName = (req: ActionRequest): string =>
  req.kind === "support_action" ? req.action.type : req.kind;

/** Runs one action through the gate. Throws `ApiRequestError` for 404 / 409; a refusal is a `blocked` result. */
export function applyAction(
  state: MockState,
  caseId: string,
  req: ActionRequest,
  now: string,
): Transition {
  const kase = findCase(state, caseId);
  const { state: next, result } = decide(state, kase, req, now);
  const counted: MockState = {
    ...next,
    actions: {
      executed: next.actions.executed + (result.status === "executed" ? 1 : 0),
      blocked: next.actions.blocked + (result.status === "blocked" ? 1 : 0),
    },
  };
  const detail = `${result.status} (${result.rule}): ${result.message}`;
  const audited = addAudit(
    counted,
    { caseId, actor: "support", step: `action:${actionName(req)}`, detail },
    now,
  );
  return { state: audited, result };
}

function decide(
  state: MockState,
  kase: Case,
  req: ActionRequest,
  now: string,
): Transition {
  if (kase.verdict?.outcome === "suspicious") {
    return {
      state,
      result: blocked(
        "Case is flagged as suspicious; no actions allowed.",
        "S1",
      ),
    };
  }
  switch (req.kind) {
    case "support_action":
      return supportAction(state, kase, req.action);
    case "send_to_tech":
      return sendToTech(state, kase, now);
    case "mark_resolved":
      return {
        state: updateCase(state, kase.id, { status: "resolved" }),
        result: executed("Case marked resolved.", "-"),
      };
  }
}

function supportAction(
  state: MockState,
  kase: Case,
  action: SupportAction,
): Transition {
  const records = findRecords(state, kase.customerId);
  return action.type === "restore_access"
    ? restoreAccess(state, records, action.entitlementId)
    : refundPayment(state, records, action.paymentId);
}

function restoreAccess(
  state: MockState,
  records: CustomerRecords,
  entitlementId: string,
): Transition {
  const ent = records.entitlements.find((e) => e.id === entitlementId);
  if (!ent)
    return {
      state,
      result: blocked(
        `Entitlement ${entitlementId} does not belong to this customer.`,
        "A1",
      ),
    };
  if (ent.active)
    return {
      state,
      result: blocked(`Entitlement ${entitlementId} is already active.`, "R1"),
    };
  const paymentId =
    records.payments.find((p) => p.status === "succeeded")?.id ?? null;
  const next = updateRecords(state, records.customer.id, (r) => ({
    ...r,
    entitlements: r.entitlements.map((e) =>
      e.id === entitlementId ? { ...e, active: true, paymentId } : e,
    ),
  }));
  return {
    state: next,
    result: executed(`Access restored on ${entitlementId}.`, "R1"),
  };
}

function refundPayment(
  state: MockState,
  records: CustomerRecords,
  paymentId: string,
): Transition {
  const payment = records.payments.find((p) => p.id === paymentId);
  if (!payment)
    return {
      state,
      result: blocked(
        `Payment ${paymentId} does not belong to this customer.`,
        "A1",
      ),
    };
  if (payment.status === "refunded") {
    return {
      state,
      result: blocked(`Payment ${paymentId} is already refunded.`, "P3"),
    };
  }
  if (payment.amountUsd > REFUND_LIMIT_USD) {
    return {
      state,
      result: blocked(
        `Refunds over $${REFUND_LIMIT_USD} need a manager.`,
        "P2",
      ),
    };
  }
  const next = updateRecords(state, records.customer.id, (r) => ({
    ...r,
    payments: r.payments.map((p) =>
      p.id === paymentId ? { ...p, status: "refunded" as const } : p,
    ),
  }));
  return {
    state: next,
    result: executed(
      `Refunded $${payment.amountUsd.toFixed(2)} (${paymentId}).`,
      "P1",
    ),
  };
}

const union = (a: readonly string[], b: readonly string[]): string[] => [
  ...new Set([...a, ...b]),
];

function sendToTech(state: MockState, kase: Case, now: string): Transition {
  const verdict = kase.verdict;
  const issue =
    verdict?.outcome === "tech_team" ? verdict.techIssue : undefined;
  if (!verdict || !issue) {
    throw new ApiRequestError(409, {
      code: "conflict",
      message: "send_to_tech needs a tech_team verdict",
    });
  }
  const evidenceIds = verdict.evidence.map((e) => e.id);
  const affected = [
    kase.customerId,
    ...(SIMILAR_BY_SIGNATURE[issue.signature] ?? []),
  ];
  const existing = state.board.find((t) => t.signature === issue.signature);
  const card: TechIssue = existing
    ? {
        ...existing,
        caseIds: union(existing.caseIds, [kase.id]),
        evidenceIds: union(existing.evidenceIds, evidenceIds),
        affectedCustomerIds: union(existing.affectedCustomerIds, affected),
      }
    : {
        id: `tech_${String(state.board.length + 1).padStart(4, "0")}`,
        signature: issue.signature,
        title: issue.title,
        rootCause: issue.rootCause,
        evidenceIds,
        caseIds: [kase.id],
        affectedCustomerIds: union([], affected),
        status: "new",
        createdAt: now,
      };
  const board = existing
    ? state.board.map((t) => (t.id === card.id ? card : t))
    : [card, ...state.board];
  const next = updateCase({ ...state, board }, kase.id, {
    status: "with_tech",
  });
  const message = `${existing ? "Merged into" : "Created"} tech card "${card.title}" · ${card.affectedCustomerIds.length} customers.`;
  return { state: next, result: executed(message, "T1", card) };
}
