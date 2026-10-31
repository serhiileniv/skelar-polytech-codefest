# API contract — Go backend ↔ frontend

Version: **v1** · 2026-10-31 · Owners: backend (Go), frontend (Next.js)

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
