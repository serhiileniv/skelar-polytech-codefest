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
  TechTicket,
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

export const MAX_REPLY_CHARS = 3000;
const AUDIT_PREVIEW_CHARS = 120;

/** Posts a support message (1–3000 chars after trim); open → waiting_customer. Throws 400 otherwise. */
export function postReply(
  state: MockState,
  caseId: string,
  body: string,
  now: string,
): MockState {
  const text = body.trim();
  if (text.length < 1 || text.length > MAX_REPLY_CHARS) {
    throw new ApiRequestError(400, {
      code: "bad_request",
      message: `Reply must be 1–${MAX_REPLY_CHARS} characters`,
    });
  }
  const kase = findCase(state, caseId);
  const message = {
    id: `msg_s${String(state.seq + 1).padStart(4, "0")}`,
    from: "support" as const,
    body: text,
    at: now,
  };
  const status = kase.status === "open" ? "waiting_customer" : kase.status;
  const withMessage = updateCase(state, caseId, {
    messages: [...kase.messages, message],
    status,
  });
  return addAudit(
    withMessage,
    {
      caseId,
      actor: "support",
      step: "reply",
      detail: text.slice(0, AUDIT_PREVIEW_CHARS),
    },
    now,
  );
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
      return supportAction(state, kase, req.action, now);
    case "send_to_tech":
      return sendToTech(state, kase, now);
    case "create_tech_ticket":
      return createTechTicket(state, kase, req.ticket, now);
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
  now: string,
): Transition {
  const records = findRecords(state, kase.customerId);
  switch (action.type) {
    case "restore_access":
      return restoreAccess(state, records, action.entitlementId);
    case "refund_payment":
      return refundPayment(state, records, action.paymentId);
    case "cancel_subscription":
      return cancelSubscription(state, records, action.subscriptionId, now);
    case "send_magic_link":
      return sendMagicLink(state, kase, records);
  }
}

/** C1: cancel only an active subscription of this customer. App Store cancels go through the simulated store connector. */
function cancelSubscription(
  state: MockState,
  records: CustomerRecords,
  subscriptionId: string,
  now: string,
): Transition {
  const sub = records.subscriptions.find((s) => s.id === subscriptionId);
  if (!sub)
    return {
      state,
      result: blocked(
        `Subscription ${subscriptionId} does not belong to this customer.`,
        "C1",
      ),
    };
  if (sub.status !== "active")
    return {
      state,
      result: blocked(`Subscription ${subscriptionId} is not active.`, "C1"),
    };
  const next = updateRecords(state, records.customer.id, (r) => ({
    ...r,
    subscriptions: r.subscriptions.map((s) =>
      s.id === subscriptionId
        ? {
            ...s,
            status: "canceled" as const,
            canceledAt: now,
            renewsAt: null,
          }
        : s,
    ),
  }));
  const via =
    sub.channel === "app_store" ? " via simulated App Store connector" : "";
  return {
    state: next,
    result: executed(`Canceled ${subscriptionId}${via}.`, "C1"),
  };
}

const MAGIC_LINK_STEP = "action:send_magic_link";

/** E1: at most one magic-link email per case. (The mock has no session events, so the reset-request check is the Go gate's alone.) */
function sendMagicLink(
  state: MockState,
  kase: Case,
  records: CustomerRecords,
): Transition {
  const alreadySent = state.audit.some(
    (a) =>
      a.caseId === kase.id &&
      a.step === MAGIC_LINK_STEP &&
      a.detail.startsWith("executed"),
  );
  if (alreadySent)
    return {
      state,
      result: blocked("A login link was already sent for this case.", "E1"),
    };
  return {
    state,
    result: executed(
      `One-time login link sent to ${records.customer.email}.`,
      "E1",
    ),
  };
}

/** F1: Fix-it only for a non-downgraded `user_can_fix` / `support_can_fix`; S1 first. Throws 409 otherwise. */
export function assertFixAllowed(kase: Case): void {
  const v = kase.verdict;
  const refuse = (message: string) =>
    new ApiRequestError(409, { code: "conflict", message });
  if (v?.outcome === "suspicious")
    throw refuse("S1: case is flagged as suspicious; Fix-it is off.");
  if (!v) throw refuse("F1: investigate the case before Fix-it.");
  if (v.downgraded)
    throw refuse("F1: the verdict was downgraded by the validator.");
  if (v.outcome !== "user_can_fix" && v.outcome !== "support_can_fix")
    throw refuse(`F1: no safe customer-level fix for ${v.outcome}.`);
}

/** Gate dry run: what `applyAction` would return now, without keeping any change. */
export function previewAction(
  state: MockState,
  caseId: string,
  req: ActionRequest,
  now: string,
): ActionResult {
  return decide(state, findCase(state, caseId), req, now).result;
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
        evidence: verdict.evidence,
        messageIds: [],
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

/** Ids the mock cannot check (no event/error logs in the mock world); the Go T2 gate checks them. */
const LOG_ID = /^(err|ev|mail)_/;

/** T2: verdict exists, evidence is this case's records with ≥1 err_*, no open card lists the case. Status unchanged. */
function createTechTicket(
  state: MockState,
  kase: Case,
  ticket: TechTicket,
  now: string,
): Transition {
  const ids = ticket.evidence.map((e) => e.id);
  const records = findRecords(state, kase.customerId);
  const owned = new Set([
    kase.id,
    ...kase.messages.map((m) => m.id),
    ...records.subscriptions.map((x) => x.id),
    ...records.payments.map((x) => x.id),
    ...records.entitlements.map((x) => x.id),
  ]);
  const open = state.board.find(
    (t) => t.status !== "resolved" && t.caseIds.includes(kase.id),
  );
  const foreign = ids.find((id) => !owned.has(id) && !LOG_ID.test(id));
  const refuse = !kase.verdict
    ? "Investigate the case before creating a tech ticket."
    : open
      ? `Ticket ${open.id} is already open for ${kase.id}.`
      : foreign
        ? `Evidence ${foreign} is not a record of this case or its customer.`
        : !ids.some((id) => id.startsWith("err_"))
          ? "A tech ticket must cite at least one error log (err_*) of this customer."
          : null;
  if (refuse) return { state, result: blocked(refuse, "T2") };
  const existing = state.board.find(
    (t) => t.status !== "resolved" && t.signature === ticket.signature,
  );
  const affected = [
    kase.customerId,
    ...(SIMILAR_BY_SIGNATURE[ticket.signature] ?? []),
  ];
  const messageIds = kase.messages.map((m) => m.id);
  const card: TechIssue = existing
    ? {
        ...existing,
        caseIds: union(existing.caseIds, [kase.id]),
        evidenceIds: union(existing.evidenceIds, ids),
        evidence: [
          ...existing.evidence,
          ...ticket.evidence.filter(
            (e) => !existing.evidenceIds.includes(e.id),
          ),
        ],
        messageIds: union(existing.messageIds, messageIds),
        affectedCustomerIds: union(existing.affectedCustomerIds, affected),
      }
    : {
        id: `tech_${String(state.board.length + 1).padStart(4, "0")}`,
        signature: ticket.signature,
        title: ticket.title,
        rootCause: ticket.rootCause,
        evidenceIds: ids,
        evidence: ticket.evidence,
        messageIds,
        caseIds: [kase.id],
        affectedCustomerIds: union([], affected),
        status: "new",
        createdAt: now,
      };
  const board = existing
    ? state.board.map((t) => (t.id === card.id ? card : t))
    : [card, ...state.board];
  const message = `${existing ? "Added the case to" : "Created"} tech ticket ${card.id} "${card.title}" · ${card.evidenceIds.length} evidence · ${card.affectedCustomerIds.length} customers affected.`;
  return { state: { ...state, board }, result: executed(message, "T2", card) };
}
