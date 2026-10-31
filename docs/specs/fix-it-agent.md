# Spec: Fix-it agent (stretch S1)

## Goal
After Investigate returns `user_can_fix` or `support_can_fix`, a second agent loop resolves the case itself through our app's own MCP tools: it proposes a fix plan, a human approves it once, then the backend runs each write through the policy gate, replies and marks the case resolved. Each write is audited.
Maps to capability 2 (initiate actions). Raises "Operational Impact" + "Use of AI" + "Innovation" (`docs/criteria.md`): a chatbot explains, Verdict fixes the problem.
Demo: case_101 cancels the App Store subscription instead of sending steps; 102 resends the reset email; 103 restores access; 105 refunds the duplicate.

## Non-goals
- Fix-it for `tech_team` / `need_more_info` / `suspicious`: no safe customer-level fix exists; S1 still blocks everything on 107.
- Autonomous writes without a click: decision "agent recommends, human clicks" (`docs/decisions.md`).
- Claude API MCP connector: it needs a public URL and skips our replay + SSE trace.
- Auth on `/mcp`: local demo only, not deployed publicly. A public deploy needs a token first.
- Persisting plans in Postgres: an in-memory plan store is enough. After a restart, approve returns 404 and the user re-runs Fix-it.
- Atomic multi-step plans: each step reuses `ExecuteAction` (its own tx). The run stops at the first block.

## Current state
- Agent loop: `backend/internal/usecase/investigate_case.go`. `MaxSteps=8`, per-case `running` lock (409), last step allows only the final tool, every tool call audited as `tool:<name>`.
- Read tools bound to the case's customer, no id inputs: `usecase/agent_tools.go` (`caseTools.run`, `AgentTools()`).
- Model port: `usecase/agent_model.go` (`AgentModel.Start(ctx, key, system, prompt, tools)`). Replay is keyed by case id and reads `backend/replay/<key>.json` (`adapter/llm/replay.go`).
- Gate: `entity/policy.go` `EvaluateAction` (A1 R1 P1 P2 P3 S1). Only `restore_access` / `refund_payment` exist.
- Writes: `usecase/execute_action.go`. The gate, the change and the audit row commit in one tx. Blocked attempts are audited in a second tx. A support action sets the case to `resolved`.
- `CaseTx` (`usecase/ports.go`) has no cancel-subscription or send-email methods.
- Seed (`internal/seed/seed.go`): `sub_0001` is app_store + active (cust_001, `ev_0001` app_deleted). cust_002 has 3 delivered `password_reset` mails (`mail_0001..3`).
- Routes: `controller/http/server.go` `NewRouter`, stdlib mux. SSE handler pattern in `handlers.go` `postInvestigate`.
- No MCP dependency in `backend/go.mod`.
- FE: `ApiClient` (`frontend/src/api/client.ts`) has `investigate(id, onEvent)`. Trace logic is `components/verdict/investigate-trace.ts` (`traceReducer`, `groupSteps`). "Next step" block: `verdict-card.tsx:236`. Mock scripts: `api/mock/scripts.ts`. Mock gate: `api/mock/policy.ts`.

## Proposed design

**1. MCP server**
- SDK: `github.com/modelcontextprotocol/go-sdk` **v1.8.0** (verified on proxy.golang.org, tagged 2026-09-04; API checked with `go doc`): `mcp.NewServer`, generic `mcp.AddTool[In,Out]` (schema inferred from the struct + `jsonschema` tags, input validated before the handler runs), `mcp.NewStreamableHTTPHandler(getServer, nil)`, `ToolAnnotations{ReadOnlyHint, DestructiveHint}`.
- Mounted in the API process at `/mcp/cases/{id}` over Streamable HTTP. No `cmd/mcp`: one process, one DB pool.
- `getServer(r)` builds a server bound to `r.PathValue("id")`, so tools take no case or customer ids (same scoping as `caseTools`). Invalid or unknown id → nil → 400.
- One tool registry, `usecase/fix_tools.go`, serves both the loop and the MCP server. `controller/mcp/server.go` only adapts it with `AddTool`.

| Tool | Kind | Input | Backed by |
|---|---|---|---|
| `getCase` | read | `{}` | chat + current verdict (`InvestigationStore.Case`) |
| `getBilling` / `getEntitlements` / `getEmailLog` | read | `{}` | existing `caseTools.run` |
| `cancelSubscription` | write (proposal) | `{subscriptionId, reason}` | new `cancel_subscription` action |
| `sendMagicLink` | write (proposal) | `{reason}` | new `send_magic_link` action (decision 2) |
| `restoreAccess` | write (proposal) | `{entitlementId, reason}` | existing `restore_access` |
| `refundPayment` | write (proposal) | `{paymentId, reason}` | existing `refund_payment` |
| `noteManualStep` | manual step (decision 4) | `{owner: support\|customer\|tech, title, detail}` | queues an instruction, never executes |
| `submitFixPlan` | final (loop only) | `{problem, summary, replyBody (10–3000)}` | closes the plan |

- **A write tool never executes.** It appends a step to the case's pending plan and returns `{queued: true, wouldBe, rule, previewMessage}` (a dry run of `EvaluateAction`). This holds over external MCP clients too, so the human click cannot be bypassed.
- MCP tools are registered with the low-level `Server.AddTool` from the shared `ToolSpec`s, so the Go registry is the single validator (no second schema from struct tags).

**2. Fix-it loop**
- Recommended: the Go loop calls the registry **directly**, not through an in-process MCP client. Why: no extra hop, replay and fake-LLM tests work as they do today, and MCP stays the external surface over the same handlers. An MCP smoke test (`mcp.NewInMemoryTransports`) proves that surface works.
- `usecase/fix_case.go` copies the shape of `InvestigateCase`. It has its own `running` lock and `FixMaxSteps = 6`, and the last step allows only `submitFixPlan`. Replay key is `fix_<caseId>`.
- Start check, rule **F1**: the verdict outcome must be `user_can_fix` or `support_can_fix` and `downgraded=false`. Otherwise 409 `conflict`. S1 is checked first.
- **Flow: plan → approve once → execute.** The agent proposes writes, and `submitFixPlan` emits a `plan` event. The human sees the steps with their gate previews and clicks "Approve & run" once. The server then:
  1. Runs each step via `ExecuteAction.Execute` in order, so the gate is re-evaluated against live state. A blocked step stops the run and the remaining steps are `skipped`.
  2. If every step executed: `ReplyToCase(replyBody)`, then `mark_resolved`.
  3. Audits `fix:plan_proposed` (ai), `fix:approved` (support), each step's existing action audit, and `fix:completed`/`fix:stopped`.
- Why approve once, not per write: one click is enough to demo by 17:00. Per-step gating still happens at run time.
- Plan store: in-memory `map[caseID]*FixPlan` under a mutex. A new run replaces the case's pending plan.

**3. Contract delta (`docs/api.md`, v2 additions, backward compatible)** — superseded in detail by decision 4; `docs/api.md` → Fix-it is the source of truth.
- `SupportAction` adds `{type:"cancel_subscription"; subscriptionId; reason}` and `{type:"resend_password_reset"; reason}`. `submitVerdict`'s enum stays unchanged.
- New rules:
  - **C1**: cancel only an active subscription of this customer.
  - **E1**: resend only if a `password_reset_requested` event exists in the last 24h, max 1 resend per case.
  - **F1**: Fix-it only for a non-downgraded `user_can_fix`/`support_can_fix`.
- New endpoints:

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/api/cases/{id}/fix` | — | SSE, same order as investigate; `plan` replaces `verdict` |
| POST | `/api/cases/{id}/fix/{planId}/approve` | — | `FixRunResult` |
| — | `/mcp/cases/{id}` | MCP Streamable HTTP | external surface (not used by the UI) |

```ts
type FixToolName = "getCase" | "getBilling" | "getEntitlements" | "getEmailLog" | "cancelSubscription"
  | "resendPasswordReset" | "restoreAccess" | "refundPayment" | "submitFixPlan";
interface FixStep { id: string; action: SupportAction; label: string;          // "Cancel App Store sub_0001"
  preview: { allowed: boolean; rule: string; reason: string } }
interface FixPlan { id: string; caseId: string; summary: string; steps: FixStep[]; replyBody: string; createdAt: string }
interface FixRunResult { planId: string; status: "executed" | "stopped";
  steps: { stepId: string; status: "executed" | "blocked" | "skipped"; result: ActionResult | null }[];
  replied: boolean; resolved: boolean }
```
- SSE events: `start` gains `mode: "fix"`. New event `plan: { plan: FixPlan }`. `tool_call.tool` is `FixToolName`.
- Errors: approve on an unknown or stale plan → 404. Approving twice → 409.
- Demo world: no new seed rows. Repo needs `CancelSubscription(subID, at)` (status canceled, canceledAt, renewsAt=null) and `AddEmail(customerID, template)` (new `mail_r…` id via a sequence in `0003_fix.sql`).

**4. Frontend**
- `ApiClient` adds `fix(id, onEvent, signal)` and `approveFix(id, planId): Promise<FixRunResult>`. Types go verbatim into `api/types.ts`.
- `verdict-card.tsx` Next step: a primary "Fix it for the customer" button, only when F1 holds. The existing actions become secondary.
- `fix-panel.tsx`: reuses `traceReducer`/`groupSteps` + `trace.tsx` timeline (header "Fix-it · step n of 6"). On `plan` it renders a plan card: summary, one row per step with a rule chip from `preview` (red if `!allowed`), the reply preview, and "Approve & run (n)" / "Discard". After approve: a per-step ✓/blocked/skipped row with its rule chip, a toast, then a case refetch (reply in chat, status resolved).
- Mock first: `api/mock/fix-scripts.ts` holds scripted streams for 101/102/103/105. `mock/policy.ts` adds C1/E1/F1. The mock world applies cancel/email/restore/refund + reply + resolve in memory.

**5. Tasks (~2h, start only after F2 is green)**
- BE (teammate), in order:
  1. Entity: new action types, C1/E1/F1 + table tests (25m).
  2. `CaseTx.CancelSubscription`/`AddEmail` + `0003_fix.sql` + `ExecuteAction` branches (20m).
  3. `fix_tools.go` + `fix_case.go` + plan store + approve, fake-LLM tests (40m).
  4. Handlers and routes (10m).
  5. Scripted `replay/fix_case_10{1,2,3,5}.json` (15m).
  6. `/mcp/cases/{id}` mount + in-memory smoke test (20m).
- FE (Serhii), in order:
  1. Types, client and mock (fix scripts, policy, world) (40m).
  2. Button, fix panel and plan card (50m).
  3. Flip `fix`/`approveFix` to http after BE step 4 (10m).
  4. Browser pass on 101 → 107.
- Cut order if late: 105 → 103 → 102 → gate preview at plan time → MCP mount. Never cut: the gate on execute, the approve click, the audit, case_101.

## Acceptance criteria
- [ ] `go test ./...`: table tests for C1, E1, F1. Fake-LLM test: the loop never calls `ExecuteAction`, the last step offers only `submitFixPlan`, and writes before approval leave the DB unchanged.
- [ ] case_101 fix → approve: `sub_0001` is `canceled` with `renewsAt=null`, a support reply is in chat, status is `resolved`, and the audit has `fix:plan_proposed`, `fix:approved`, `cancel_subscription` (C1), `fix:completed`.
- [ ] case_102: approve adds one `password_reset` mail. A second approve → 409. A new plan's resend preview shows E1 blocked.
- [ ] `POST /fix` on 104, 106 and 107 → 409. The UI shows no Fix-it button for them.
- [ ] Approving a plan whose step the gate now blocks returns `status:"stopped"`, the remaining steps `skipped`, and no reply.
- [ ] MCP smoke test: an in-memory client lists 8 tools for `case_101`. Calling `cancelSubscription` returns `queued:true` and the subscription is still `active`.
- [ ] `curl -N -X POST :8080/api/cases/case_101/fix` streams `start`…`plan`→`done` on replay, without an API key.
- [ ] FE: `pnpm typecheck && pnpm lint && pnpm test` pass, with a mock test for 101 approve → resolved. No console errors during 101 Fix-it.
- Can't check: whether the live model picks the same plan as the scripted replay. Only `make eval`-style live runs show that.

## Open questions
1. As far as I know (not verified here), Apple's App Store Server API cannot cancel a customer's subscription; only the user can. Show case_101's cancel as a simulated "store connector" with a note on the slide? Or reframe it as "turn off auto-renew in our records + tell the user"?
2. case_102: resending a reset email doesn't fix "it's in spam". Send a one-time login link (new template `magic_link`) instead?
3. Will the BE teammate have the ~2h after F2? If not, does FE ship a mock-only Fix-it in the video, marked as such?

## Decisions
Approved 2026-10-31:
1. case_101: simulated store connector — the MCP "App Store" tool cancels in our demo world; UI + slide label it "simulated connector".
2. case_102: send a one-time `magic_link` login email instead of resending the reset.
3. Real Fix-it agent loop (Claude, Go) built by Serhii's agents (BE + FE), not the teammate; external systems (store, email) are mocks behind our MCP tools. Additive files only in backend/ to avoid clashing with the teammate.
4. Capability catalog + proposals + manual steps (2026-10-31, user):
   - Catalog: every write tool declares `actor: customer|support` + one-line description. `GET /api/fix/capabilities` → `FixCapability[] {tool, actor, label, description, rule}`, the same list MCP publishes. Catalog: `cancelSubscription` (customer, C1), `sendMagicLink` (customer, E1), `restoreAccess` (support, R1), `refundPayment` (support, P1). Reply and resolve are not catalog steps: approve does them.
   - The system prompt lists the exact catalog; anything outside it becomes a manual step via `noteManualStep` with owner `support|customer|tech`.
   - `FixPlan {id, caseId, problem, summary, steps, replyBody, createdAt}`; `steps` is one ordered list of auto + manual steps. `FixStep {id, kind: auto|manual, owner: agent|support|customer|tech, title, detail}`; auto steps add `tool, actor, input, rule, wouldBe: executed|blocked, previewMessage`.
   - Approve takes the selection: `POST /api/cases/{id}/fix/{planId}/approve {stepIds}`. Only selected auto steps run, in plan order, via `ExecuteAction`, stopping at the first block; skipped ones are audited in `fix:approved` / `fix:completed|stopped`. Reply when every selected step executed; resolve only if also no manual step. Otherwise the case is left `waiting_customer`.
