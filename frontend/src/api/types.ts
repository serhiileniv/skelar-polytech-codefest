/** Contract types. Copied from `docs/api.md` (v1 + v2 Fix-it) — change that file first, then this one. */

export type Platform = "web" | "ios" | "android";
export type Outcome =
  | "user_can_fix"
  | "support_can_fix"
  | "tech_team"
  | "need_more_info"
  | "suspicious";
export type Signature =
  "cancel_not_synced" | "entitlement_grant_failed" | "duplicate_charge";
export type CaseStatus = "open" | "waiting_customer" | "with_tech" | "resolved";

export interface ApiError {
  code:
    "bad_request" | "not_found" | "conflict" | "llm_unavailable" | "internal";
  message: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  platform: Platform;
  appVersion: string;
  country: string;
  createdAt: string;
}

export interface Subscription {
  id: string;
  channel: "web" | "app_store";
  plan: "monthly" | "yearly";
  priceUsd: number;
  status: "active" | "canceled";
  renewsAt: string | null;
  canceledAt: string | null;
}

export interface Payment {
  id: string;
  subscriptionId: string;
  channel: "web" | "app_store";
  amountUsd: number;
  status: "succeeded" | "refunded" | "failed";
  at: string;
}

export interface Entitlement {
  id: string;
  accountEmail: string;
  active: boolean;
  paymentId: string | null;
  grantedAt: string | null;
}

export interface ChatMessage {
  id: string;
  from: "customer" | "support";
  body: string;
  at: string;
}

export type SupportAction =
  | { type: "restore_access"; entitlementId: string; reason: string }
  | { type: "refund_payment"; paymentId: string; reason: string }
  | { type: "cancel_subscription"; subscriptionId: string; reason: string }
  | { type: "send_magic_link"; reason: string };

export interface Verdict {
  outcome: Outcome;
  modelOutcome: Outcome;
  downgraded: boolean;
  validationNotes: string[];
  confidence: number;
  customerGoal: string;
  summary: string;
  evidence: { id: string; note: string }[];
  instructionSteps?: string[];
  helpArticleId?: string;
  supportAction?: SupportAction;
  techIssue?: { signature: Signature; title: string; rootCause: string };
  clarifyingQuestion?: string;
  replyDraft: string;
  stepsUsed: number;
  createdAt: string;
}

export interface Case {
  id: string;
  customerId: string;
  subject: string;
  messages: ChatMessage[];
  status: CaseStatus;
  createdAt: string;
  verdict: Verdict | null;
}

export interface AuditEntry {
  id: string;
  caseId: string;
  actor: "ai" | "support" | "system";
  step: string;
  detail: string;
  at: string;
}

export interface TechIssue {
  id: string;
  signature: Signature;
  title: string;
  rootCause: string;
  evidenceIds: string[];
  caseIds: string[];
  affectedCustomerIds: string[];
  status: "new" | "in_progress" | "resolved";
  createdAt: string;
}

export interface CaseListItem {
  id: string;
  subject: string;
  customerName: string;
  preview: string;
  status: CaseStatus;
  outcome: Outcome | null;
  createdAt: string;
}

export interface CaseDetail {
  case: Case;
  customer: Customer;
  subscriptions: Subscription[];
  payments: Payment[];
  entitlements: Entitlement[];
  audit: AuditEntry[];
}

export type ActionRequest =
  | { kind: "support_action"; action: SupportAction }
  | { kind: "send_to_tech" }
  | { kind: "mark_resolved" };

export interface ActionResult {
  status: "executed" | "blocked";
  message: string;
  rule: string;
  techIssue?: TechIssue;
}

export interface Metrics {
  totalCases: number;
  investigated: number;
  byOutcome: Record<Outcome, number>;
  keptFromTech: number;
  downgraded: number;
  avgSteps: number;
  actions: { executed: number; blocked: number };
  eval: { correct: number; total: number; ranAt: string } | null;
}

export type ToolName =
  | "getChat"
  | "getCustomer"
  | "getBilling"
  | "getEntitlements"
  | "getSessionEvents"
  | "getErrorLogs"
  | "getEmailLog"
  | "searchHelp"
  | "findSimilarCustomers"
  | "submitVerdict";

/** One SSE event from `POST /api/cases/{id}/investigate`. */
export type InvestigateEvent =
  | {
      event: "start";
      data: {
        caseId: string;
        replay: boolean;
        model: string;
        maxSteps: number;
      };
    }
  | { event: "step"; data: { n: number } }
  | { event: "text"; data: { delta: string } }
  | {
      event: "tool_call";
      data: { callId: string; tool: ToolName; input: object };
    }
  | {
      event: "tool_result";
      data: { callId: string; tool: ToolName; output: unknown; ids: string[] };
    }
  | { event: "verdict"; data: { verdict: Verdict } }
  | { event: "error"; data: ApiError }
  | { event: "done"; data: Record<string, never> };

export type InvestigateEventName = InvestigateEvent["event"];

/** v2 Fix-it: tools of the fix loop (also served over `/mcp/cases/{id}`). */
export type FixToolName =
  | "getCase"
  | "getBilling"
  | "getEntitlements"
  | "getEmailLog"
  | "cancelSubscription"
  | "sendMagicLink"
  | "restoreAccess"
  | "refundPayment"
  | "noteManualStep"
  | "submitFixPlan";

/** Who an auto step acts as. */
export type FixActor = "customer" | "support";

/** A write Fix-it can queue; also `FixAutoStep.tool`. */
export type FixWriteTool =
  "cancelSubscription" | "sendMagicLink" | "restoreAccess" | "refundPayment";

/** One entry of `GET /api/fix/capabilities`: what Fix-it can do. */
export interface FixCapability {
  tool: FixWriteTool;
  actor: FixActor;
  label: string;
  description: string;
  rule: string;
}

/** A write the agent runs once support selects it; `wouldBe` is the gate's dry run at plan time. */
export interface FixAutoStep {
  id: string;
  kind: "auto";
  owner: "agent";
  title: string;
  detail: string;
  tool: FixWriteTool;
  actor: FixActor;
  input: Record<string, unknown>;
  rule: string;
  wouldBe: "executed" | "blocked";
  previewMessage: string;
}

/** Something Fix-it cannot do; a person has to. */
export interface FixManualStep {
  id: string;
  kind: "manual";
  owner: "support" | "customer" | "tech";
  title: string;
  detail: string;
}

export type FixStep = FixAutoStep | FixManualStep;

export interface FixPlan {
  id: string;
  caseId: string;
  /** The confirmed problem, with evidence ids. */
  problem: string;
  /** How the steps resolve it. */
  summary: string;
  /** One ordered list, auto and manual mixed. */
  steps: FixStep[];
  /** Sent as support after the selected steps, unless the run stopped. */
  replyBody: string;
  createdAt: string;
}

export interface FixStepResult {
  stepId: string;
  status: "executed" | "blocked" | "skipped";
  result: ActionResult | null;
}

export interface FixRunResult {
  planId: string;
  status: "executed" | "stopped";
  steps: FixStepResult[];
  replied: boolean;
  resolved: boolean;
}

/** One SSE event from `POST /api/cases/{id}/fix`; `plan` replaces `verdict`. */
export type FixEvent =
  | {
      event: "start";
      data: {
        caseId: string;
        replay: boolean;
        model: string;
        maxSteps: number;
        mode: "fix";
      };
    }
  | { event: "step"; data: { n: number } }
  | { event: "text"; data: { delta: string } }
  | {
      event: "tool_call";
      data: { callId: string; tool: FixToolName; input: object };
    }
  | {
      event: "tool_result";
      data: {
        callId: string;
        tool: FixToolName;
        output: unknown;
        ids: string[];
      };
    }
  | { event: "plan"; data: { plan: FixPlan } }
  | { event: "error"; data: ApiError }
  | { event: "done"; data: Record<string, never> };

/** v2 Ask: `POST /api/cases/{id}/ask` → an answer grounded in the stored verdict's records. */
export interface AskResult {
  answer: string;
  /** Record ids the answer cites; the server drops ids outside the case. */
  evidence: string[];
}

/** Any event either agent stream can emit. */
export type StreamEvent = InvestigateEvent | FixEvent;
export type StreamEventName = StreamEvent["event"];
