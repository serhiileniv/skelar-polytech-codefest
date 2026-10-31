# API contract — Resolly Go backend ↔ frontend

Version: **v2** · 2026-10-31 · Owners: backend (Go), frontend (Next.js) · v2 = v1 + [Fix-it](#fix-it-v2-additive), additive only

This file is the only interface between the two tracks. Each side builds against this file, not against the other's code.

## Change rules

- **Additive** (new endpoint, new optional field, new enum value the UI can ignore): edit this file in the same PR + ping the other dev.
- **Breaking** (rename, remove, type change, required field): agree first, then bump the version line above.
- If the code and this file disagree, this file wins until it is changed.

## Conventions

| Topic | Rule |
|---|---|
| Base URL | `NEXT_PUBLIC_API_URL` (dev: `http://localhost:8080`). All paths start with `/api` except `/health`. |
| CORS | Backend allows the origin in `FRONTEND_ORIGIN` (dev: `http://localhost:3000`). |
| JSON | `camelCase` keys. `Content-Type: application/json`. |
| Time | ISO 8601 UTC strings, e.g. `"2026-10-31T09:20:00Z"`. |
| Ids | Strings, stable, from the seed (`case_103`, `cust_003`, `pay_…`, `ent_…`, `err_…`). Path ids match `^[a-zA-Z0-9_-]{1,64}$`. |
| Money | `amountUsd`/`priceUsd` as a number (`29.99`). |
| Arrays | Always `[]`, never `null` (Go: initialise slices). |
| Optional | `field?: T` = may be absent. `field: T \| null` = always present, may be `null`. |
| Errors | Non-2xx → `ApiError` body (below). |

```ts
interface ApiError {
  code: "bad_request" | "not_found" | "conflict" | "llm_unavailable" | "internal";
  message: string; // safe to show in a toast
}
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `bad_request` | Invalid id or body |
| 404 | `not_found` | Unknown case |
| 409 | `conflict` | Investigation already running for this case, or the action does not fit the case state |
| 503 | `llm_unavailable` | No API key and no replay recording |
| 500 | `internal` | Anything else (details only in server logs) |

A policy-gate refusal is **not** an error: it is `200` with `ActionResult.status = "blocked"`.

## Types

```ts
type Platform = "web" | "ios" | "android";
type Outcome = "user_can_fix" | "support_can_fix" | "tech_team" | "need_more_info" | "suspicious";
type Signature = "cancel_not_synced" | "entitlement_grant_failed" | "duplicate_charge";
type CaseStatus = "open" | "waiting_customer" | "with_tech" | "resolved";

interface Customer {
  id: string; name: string; email: string; platform: Platform;
  appVersion: string; country: string; createdAt: string;
}

interface Subscription {
  id: string; channel: "web" | "app_store"; plan: "monthly" | "yearly"; priceUsd: number;
  status: "active" | "canceled"; renewsAt: string | null; canceledAt: string | null;
}

interface Payment {
  id: string; subscriptionId: string; channel: "web" | "app_store"; amountUsd: number;
  status: "succeeded" | "refunded" | "failed"; at: string;
}

interface Entitlement {
  id: string; accountEmail: string; active: boolean; paymentId: string | null; grantedAt: string | null;
}

interface ChatMessage { id: string; from: "customer" | "support"; body: string; at: string; }

type SupportAction =
  | { type: "restore_access"; entitlementId: string; reason: string }
  | { type: "refund_payment"; paymentId: string; reason: string };

interface Verdict {
  outcome: Outcome;              // after validation; what the UI acts on
  modelOutcome: Outcome;         // what the model proposed
  downgraded: boolean;           // true → validator changed it to need_more_info
  validationNotes: string[];     // why it was downgraded
  confidence: number;            // 0..1
  customerGoal: string;
  summary: string;               // cites evidence ids
  evidence: { id: string; note: string }[];
  instructionSteps?: string[];   // user_can_fix
  helpArticleId?: string;        // user_can_fix
  supportAction?: SupportAction; // support_can_fix; never present for suspicious
  techIssue?: { signature: Signature; title: string; rootCause: string }; // tech_team
  clarifyingQuestion?: string;   // need_more_info
  replyDraft: string;            // prefill for the reply box
  stepsUsed: number;
  createdAt: string;
}

interface Case {
  id: string; customerId: string; subject: string; messages: ChatMessage[];
  status: CaseStatus; createdAt: string; verdict: Verdict | null;
}

interface AuditEntry {
  id: string; caseId: string; actor: "ai" | "support" | "system";
  step: string;   // e.g. "tool:getBilling", "verdict_submitted", "blocked:refund_payment", "restore_access"
  detail: string; at: string;
}

interface TechIssue {
  id: string; signature: Signature; title: string; rootCause: string;
  evidenceIds: string[]; caseIds: string[]; affectedCustomerIds: string[];
  status: "new" | "in_progress" | "resolved"; createdAt: string;
}
```

## Endpoints

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/health` | — | `{ status: "ok" }` |
| GET | `/api/cases` | — | `CaseListItem[]`, newest first |
| GET | `/api/cases/{id}` | — | `CaseDetail` |
| POST | `/api/cases/{id}/investigate` | — | SSE stream (below) |
| POST | `/api/cases/{id}/actions` | `ActionRequest` | `ActionResult` |
| POST | `/api/cases/{id}/reply` | `{ body: string }` (1–3000 chars) | `CaseDetail` |
| GET | `/api/board` | — | `TechIssue[]`, newest first |
| GET | `/api/metrics` | — | `Metrics` |
| DELETE | `/api/state` | — | `{ reset: true }` (re-seeds the demo) |

```ts
interface CaseListItem {
  id: string; subject: string; customerName: string;
  preview: string;              // last message, ≤ 120 chars
  status: CaseStatus; outcome: Outcome | null; createdAt: string;
}

interface CaseDetail {
  case: Case; customer: Customer;
  subscriptions: Subscription[]; payments: Payment[]; entitlements: Entitlement[];
  audit: AuditEntry[];          // oldest first
}

type ActionRequest =
  | { kind: "support_action"; action: SupportAction } // usually verdict.supportAction, after a human click
  | { kind: "send_to_tech" }                         // needs verdict.outcome = tech_team
  | { kind: "mark_resolved" };

interface ActionResult {
  status: "executed" | "blocked";
  message: string;              // show as a toast
  rule: string;                 // policy rule id: A1 R1 P1 P2 P3 S1, T1 (send to tech), "-" (none)
  techIssue?: TechIssue;        // present for send_to_tech
}

interface Metrics {
  totalCases: number;
  investigated: number;
  byOutcome: Record<Outcome, number>; // every key present, 0 if none
  keptFromTech: number;         // verdicts with outcome ≠ tech_team
  downgraded: number;           // validator downgrades
  avgSteps: number;             // agent loop steps per investigation
  actions: { executed: number; blocked: number };
  eval: { correct: number; total: number; ranAt: string } | null; // last `make eval`
}
```

## Investigate stream (SSE)

`POST /api/cases/{id}/investigate` → `Content-Type: text/event-stream`. `EventSource` cannot POST, so the UI reads it with `fetch` + a stream parser (e.g. `@microsoft/fetch-event-source`).

Each event is `event: <name>` + `data: <JSON>`. Order: `start`, then per step `step` → `text`* → (`tool_call` → `tool_result`)*, then exactly one `verdict`, then `done`. On failure: `error`, then `done`.

| Event | Data | UI |
|---|---|---|
| `start` | `{ caseId: string; replay: boolean; model: string; maxSteps: number }` | Show "replay" badge when `replay` |
| `step` | `{ n: number }` (1-based) | Step counter |
| `text` | `{ delta: string }` | Agent's one-line reasoning before a tool call; append |
| `tool_call` | `{ callId: string; tool: ToolName; input: object }` | Trace row, spinner |
| `tool_result` | `{ callId: string; tool: ToolName; output: unknown; ids: string[] }` | Trace row done; `ids` = record ids returned |
| `verdict` | `{ verdict: Verdict }` | Verdict card; same object is now in `GET /api/cases/{id}` |
| `error` | `ApiError` | Error state |
| `done` | `{}` | Close stream, refetch case |

```ts
type ToolName =
  | "getChat" | "getCustomer" | "getBilling" | "getEntitlements" | "getSessionEvents"
  | "getErrorLogs" | "getEmailLog" | "searchHelp" | "findSimilarCustomers" | "submitVerdict";
```

Example:

```
event: start
data: {"caseId":"case_103","replay":true,"model":"claude-sonnet-5-5","maxSteps":8}

event: step
data: {"n":1}

event: text
data: {"delta":"Checking billing for the Premium payment."}

event: tool_call
data: {"callId":"c1","tool":"getBilling","input":{}}

event: tool_result
data: {"callId":"c1","tool":"getBilling","output":{"subscriptions":[],"payments":[]},"ids":["sub_003","pay_003"]}

event: verdict
data: {"verdict":{"outcome":"support_can_fix", "...":"..."}}

event: done
data: {}
```

## Demo cases (seed ids both sides can rely on)

| Case | Customer | Expected `outcome` | Key action |
|---|---|---|---|
| `case_101` | `cust_001` | `user_can_fix` | instruction |
| `case_102` | `cust_002` | `user_can_fix` | instruction (spam folder) |
| `case_103` | `cust_003` | `support_can_fix` | `restore_access` |
| `case_104` | `cust_004` | `tech_team` | `send_to_tech` → card with 38 customers |
| `case_105` | `cust_005` | `support_can_fix` | `refund_payment` (duplicate) |
| `case_106` | `cust_006` | `need_more_info` | clarifying question |
| `case_107` | `cust_007` | `suspicious` | none; any action → `blocked`, rule `S1` |

## Fix-it (v2, additive)

Spec: `docs/specs/fix-it-agent.md` (decisions 1–4). Everything above is unchanged; a v1 client keeps working.

A second agent loop (≤ 6 steps, forced final `submitFixPlan`) turns a fixable verdict into a plan of proposals. Write tools never execute: they queue steps with a gate dry run. A support member picks the auto steps to run; each goes through `POST …/actions`' gate (`ExecuteAction`), in plan order, stopping at the first block. Every tool call, the approval and each step are audited.

### Additions to v1 types

```ts
// SupportAction gains two members (also accepted by POST /api/cases/{id}/actions).
// submitVerdict's supportAction enum is unchanged (restore_access | refund_payment).
type SupportAction = /* v1 members */
  | { type: "cancel_subscription"; subscriptionId: string; reason: string } // simulated store connector for app_store
  | { type: "send_magic_link"; reason: string };                            // one-time login link, simulated email connector

// TechIssue gains (Fix-it createTechTicket; send_to_tech fills evidence from the verdict, messageIds = []):
interface TechIssue { /* v1 fields */ evidence: { id: string; note: string }[]; messageIds: string[] }

// ActionRequest gains a Fix-it-only kind, run by approve for a createTechTicket step (also accepted by POST …/actions):
//   | { kind: "create_tech_ticket"; ticket: TechTicket }
// interface TechTicket { title: string; rootCause: string; signature: Signature; evidence: { id: string; note: string }[] } // 1–8 evidence
// Its ActionResult has rule T2 and techIssue (the created card, or the open card for the signature with this case added).
// It does not change the case status.

// ActionResult.rule gains C1, E1, T2. ApiError message for a refused Fix-it start starts with S1 or F1.
// AuditEntry.step gains: "fix:plan_proposed" (ai), "fix:approved" (support), "fix:completed" | "fix:stopped" (system),
//   "cancel_subscription", "send_magic_link", "create_tech_ticket", "blocked:cancel_subscription", "blocked:send_magic_link",
//   "blocked:create_tech_ticket".
// Email log template gains "magic_link" (ids mail_r0001…).
```

### Rules

| Rule | Applies to | Allowed when |
|---|---|---|
| **C1** | `cancel_subscription` | The subscription belongs to the case's customer (else A1) and is `active` |
| **E1** | `send_magic_link` | A `password_reset_requested` event in the last 24h and no `magic_link` email in the last 24h |
| **T2** | `create_tech_ticket` | Verdict exists (S1 first); every evidence id is the case, its messages or its customer's records; at least one is the customer's error log (`err_*`); no unresolved card already lists the case. Card: same signature → the open card gains this case |
| **F1** | `POST …/fix`, `/mcp/cases/{id}` | Verdict exists, `outcome` is `user_can_fix` or `support_can_fix`, `downgraded = false`. S1 is checked first |

### Endpoints

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/fix/capabilities` | — | `FixCapability[]` (the catalog; same list the MCP server publishes as write tools) |
| POST | `/api/cases/{id}/fix` | — | SSE stream (below); 409 `conflict` when S1/F1 refuse or a run is already active |
| POST | `/api/cases/{id}/fix/{planId}/approve` | `{ stepIds: string[] }` (auto step ids; `[]` runs none) | `FixRunResult` |
| — | `/mcp/cases/{id}` | MCP Streamable HTTP | External surface over the same tools (not used by the UI). No auth: local demo only |

Approve errors: unknown or replaced plan → 404 `not_found`; already approved → 409 `conflict`; a manual, unknown or repeated step id → 400 `bad_request`. Plans live in memory: after an API restart approve returns 404, run Fix-it again.

```ts
type FixToolName =
  | "getCase" | "getBilling" | "getEntitlements" | "getEmailLog"                        // read
  | "getErrorLogs" | "findSimilarCustomers"                                              // read (as investigate)
  | "cancelSubscription" | "sendMagicLink" | "restoreAccess" | "refundPayment"          // catalog: queue an auto step
  | "createTechTicket"                                                                   // catalog: queue a tech-board ticket (T2)
  | "noteManualStep"                                                                     // queue a customer-only manual step
  | "submitFixPlan";                                                                     // final, loop only (not on MCP)

interface FixCapability {
  tool: FixToolName;             // a catalog tool
  actor: "customer" | "support"; // on whose behalf it acts
  label: string;                 // "Cancel subscription"
  description: string;           // one line
  rule: string;                  // gate rule: C1 | E1 | R1 | P1 | T2
}
// createTechTicket input: { title; rootCause; signature?; evidence: {id, note}[] }. signature defaults to the one the
// first cited error log proves (IDEMPOTENCY_KEY_MISSING → duplicate_charge, GRANT_FAILED → entitlement_grant_failed,
// CANCEL_SYNC_TIMEOUT → cancel_not_synced), else the verdict's techIssue.
// Every step support approves is a catalog tool call. Support never gets technical work: a technical root cause is a
// createTechTicket step; tech decides the fix.

interface FixStep {
  id: string;                    // "step_1"…, unique in the plan
  kind: "auto" | "manual";       // manual steps never execute; they are instructions
  owner: "agent" | "customer";  // auto → "agent"; manual steps are customer-only (noteManualStep rejects other owners)
  title: string;                 // "Cancel App Store subscription sub_0001 (simulated store connector)"
  detail: string;                // auto: the agent's reason; manual: the instruction
  // auto only:
  tool?: FixToolName;
  actor?: "customer" | "support";
  input?: object;                // the tool input, e.g. { subscriptionId, reason }
  rule?: string;                 // rule the gate dry run applied (C1, E1, R1, P1, P2, P3, A1, S1, T2)
  wouldBe?: "executed" | "blocked";
  previewMessage?: string;       // the gate's reason
}

interface FixPlan {
  id: string; caseId: string;
  problem: string;               // one sentence: the confirmed problem, citing evidence ids
  summary: string;               // one line: how the steps resolve it
  steps: FixStep[];              // ONE ordered list, auto + manual mixed; order = execution order
  replyBody: string;             // sent as the support reply after a successful run
  createdAt: string;
}

interface FixRunResult {
  planId: string;
  status: "executed" | "stopped"; // stopped = a selected step was blocked
  steps: { stepId: string; status: "executed" | "blocked" | "skipped"; result: ActionResult | null }[]; // auto steps, plan order; skipped = not selected or after the block
  replied: boolean;              // reply sent (only when status = executed)
  resolved: boolean;             // every selected step executed and no manual step in the plan (a tech ticket does not keep it open)
}
```

When not resolved, the case is left `waiting_customer` (a support action no longer auto-resolves it inside a Fix-it run).

### Fix stream (SSE)

Same framing and order as the investigate stream; `plan` replaces `verdict`.

| Event | Data |
|---|---|
| `start` | `{ caseId; replay; model; maxSteps: 6; mode: "fix" }` |
| `step` / `text` | as investigate |
| `tool_call` | `{ callId; tool: FixToolName; input }` |
| `tool_result` | `{ callId; tool: FixToolName; output; ids }`. A queue tool's output: `{ queued: true, executed: false, planId, stepId, kind, wouldBe?, rule?, previewMessage? }` |
| `plan` | `{ plan: FixPlan }` |
| `error` / `done` | as investigate. No plan within 6 steps → `error` (`conflict`) |

Replay: `backend/replay/fix_<caseId>.json` (same format as investigate recordings).

### Demo

| Case | Plan (auto → manual) |
|---|---|
| `case_101` | `cancelSubscription sub_0001` (C1, simulated App Store connector) → customer confirms in Apple ID |
| `case_102` | `sendMagicLink` (E1) → customer finds the login email. A second link within 24h → `blocked` E1 |
| `case_103` | `restoreAccess ent_0003` (R1) |
| `case_105` | `refundPayment pay_0006` (P1) |
| `case_104`, `case_106`, `case_107` | `POST …/fix` → 409 (F1, F1, S1) |

## v2 · Ask (additive)

Spec: `docs/specs/copilot-conversation.md`. Support asks Resolly about a stored verdict; answers come only from the case customer's records. Read-only: no action, no audit row.

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/api/cases/{id}/ask` | `{ question: string }` (1–500 chars, trimmed) | `AskAnswer` |

```ts
interface AskAnswer {
  answer: string;     // plain text, ~≤120 words (hard cap 1200 chars); record ids cited inline, e.g. "(err_0002)"
  evidence: string[]; // ids mentioned in `answer` that are this case customer's records, first-mention order; others dropped
}
```

Errors: bad body or question length → 400 `bad_request`; unknown case → 404 `not_found`; no verdict yet → 409 `conflict`.

- Live: one Claude call (verdict + customer records + case messages as untrusted data). Not in the evidence → the answer says so, `evidence: []`.
- No API key / `VERDICT_REPLAY=1`: answers from the verdict's summary + evidence notes (same shape, still 200).
