package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// MaxSteps bounds the agent loop (decision D1).
const MaxSteps = 8

// Emit sends one SSE event (docs/api.md → Investigate stream). An error means the client is gone.
type Emit func(event string, data any) error

// InvestigateCase runs the agent loop for one case: read-only tools bound to the case's customer,
// the last step restricted to submitVerdict, the verdict validated in code, then stored and audited.
type InvestigateCase struct {
	store InvestigationStore
	model AgentModel
	now   Clock

	mu      sync.Mutex
	running map[string]bool
}

func NewInvestigateCase(store InvestigationStore, model AgentModel, now Clock) *InvestigateCase {
	return &InvestigateCase{store: store, model: model, now: now, running: map[string]bool{}}
}

// Investigation is a started run. Start reports request errors before any byte of the stream is sent.
type Investigation struct {
	u       *InvestigateCase
	kase    entity.Case
	tools   *caseTools
	session AgentSession
	Info    ModelInfo
	shown   []string // ids the initial prompt already showed the model
}

// Start checks the case (400/404), takes the per-case lock (409) and opens the model session (503).
func (u *InvestigateCase) Start(ctx context.Context, caseID string) (*Investigation, error) {
	if err := checkID(caseID); err != nil {
		return nil, err
	}
	kase, err := u.store.Case(ctx, caseID)
	if err != nil {
		return nil, err
	}
	cust, err := u.store.Customer(ctx, kase.CustomerID)
	if err != nil {
		return nil, err
	}
	u.mu.Lock()
	if u.running[caseID] {
		u.mu.Unlock()
		return nil, entity.Fail(entity.ErrConflict, "An investigation is already running for %s.", caseID)
	}
	u.running[caseID] = true
	u.mu.Unlock()

	session, info, err := u.model.Start(ctx, caseID, SystemPrompt, CasePrompt(kase, cust), AgentTools())
	if err != nil {
		u.release(caseID)
		return nil, err
	}
	return &Investigation{u: u, kase: kase, session: session, Info: info, shown: PromptIDs(kase, cust),
		tools: &caseTools{store: u.store, kase: kase, customerID: kase.CustomerID}}, nil
}

func (u *InvestigateCase) release(caseID string) {
	u.mu.Lock()
	delete(u.running, caseID)
	u.mu.Unlock()
}

// Run drives the loop and streams events. It always ends with `done`; failures emit `error` first.
func (inv *Investigation) Run(ctx context.Context, emit Emit) (verdict entity.Verdict, err error) {
	defer inv.u.release(inv.kase.ID)
	stored := false
	defer func() { inv.session.Close(stored) }()

	if err := emit("start", map[string]any{"caseId": inv.kase.ID, "replay": inv.Info.Replay, "model": inv.Info.Model, "maxSteps": MaxSteps}); err != nil {
		return verdict, err
	}
	verdict, err = inv.loop(ctx, emit)
	if err == nil {
		err = inv.save(ctx, verdict)
	}
	if err != nil {
		_, body := errorBody(err)
		_ = emit("error", body)
		_ = emit("done", map[string]any{})
		return verdict, err
	}
	stored = true
	if err := emit("verdict", map[string]any{"verdict": verdict}); err != nil {
		return verdict, err
	}
	return verdict, emit("done", map[string]any{})
}

func (inv *Investigation) loop(ctx context.Context, emit Emit) (entity.Verdict, error) {
	ctxIDs, err := inv.validationSets(ctx)
	if err != nil {
		return entity.Verdict{}, err
	}
	var results []ToolResult
	for step := 1; step <= MaxSteps; step++ {
		final := step == MaxSteps
		if err := emit("step", map[string]any{"n": step}); err != nil {
			return entity.Verdict{}, err
		}
		turn, err := inv.session.Next(ctx, results, final)
		if err != nil {
			return entity.Verdict{}, err
		}
		if turn.Text != "" {
			if err := emit("text", map[string]any{"delta": turn.Text}); err != nil {
				return entity.Verdict{}, err
			}
		}
		results = nil
		for _, call := range turn.Calls {
			if err := emit("tool_call", map[string]any{"callId": call.ID, "tool": call.Name, "input": inputForEvent(call.Input)}); err != nil {
				return entity.Verdict{}, err
			}
			if call.Name == ToolSubmitVerdict {
				v, res, ok := inv.submit(ctx, call, ctxIDs, step)
				if err := emit("tool_result", res.event); err != nil {
					return entity.Verdict{}, err
				}
				if ok {
					return v, nil
				}
				results = append(results, res.result)
				continue
			}
			if final {
				// Only submitVerdict is allowed on the last step.
				results = append(results, inv.toolError(call, "Only submitVerdict is allowed on the final step."))
				_ = emit("tool_result", map[string]any{"callId": call.ID, "tool": call.Name, "output": map[string]any{"error": "only submitVerdict is allowed on the final step"}, "ids": []string{}})
				continue
			}
			out, inputErr, err := inv.tools.run(ctx, call.Name, call.Input)
			if err != nil {
				return entity.Verdict{}, err
			}
			if inputErr != nil {
				results = append(results, inv.toolError(call, inputErr.Error()))
				if err := emit("tool_result", map[string]any{"callId": call.ID, "tool": call.Name, "output": map[string]any{"error": inputErr.Error()}, "ids": []string{}}); err != nil {
					return entity.Verdict{}, err
				}
				continue
			}
			ids := out.ids
			if ids == nil {
				ids = []string{}
			}
			for _, id := range ids {
				ctxIDs.SeenIDs[id] = true
			}
			if err := inv.u.store.AppendAudit(ctx, entity.AuditEntry{CaseID: inv.kase.ID, Actor: entity.ActorAI, Step: "tool:" + call.Name,
				Detail: fmt.Sprintf("%s → %d records", compact(call.Input), len(ids)), At: inv.u.now()}); err != nil {
				return entity.Verdict{}, err
			}
			body, err := json.Marshal(out.output)
			if err != nil {
				return entity.Verdict{}, err
			}
			results = append(results, ToolResult{CallID: call.ID, Content: string(body)})
			if err := emit("tool_result", map[string]any{"callId": call.ID, "tool": call.Name, "output": out.output, "ids": ids}); err != nil {
				return entity.Verdict{}, err
			}
		}
	}
	return entity.NoVerdict(MaxSteps, inv.u.now(), fmt.Sprintf("The agent did not submit a valid verdict within %d steps.", MaxSteps)), nil
}

type submitResult struct {
	event  map[string]any
	result ToolResult
}

// submit parses and validates a submitVerdict call. ok=false sends the problem back to the model.
func (inv *Investigation) submit(ctx context.Context, call ToolCall, vctx entity.ValidationContext, step int) (entity.Verdict, submitResult, bool) {
	draft, err := entity.ParseVerdictDraft(call.Input)
	if err != nil {
		msg := err.Error()
		return entity.Verdict{}, submitResult{
			event:  map[string]any{"callId": call.ID, "tool": call.Name, "output": map[string]any{"accepted": false, "error": msg}, "ids": []string{}},
			result: inv.toolError(call, msg+". Fix the input and call submitVerdict again."),
		}, false
	}
	vctx.StepsUsed = step
	vctx.Now = inv.u.now()
	v := entity.ValidateVerdict(draft, vctx)
	ids := make([]string, 0, len(v.Evidence))
	for _, e := range v.Evidence {
		ids = append(ids, e.ID)
	}
	return v, submitResult{event: map[string]any{"callId": call.ID, "tool": call.Name,
		"output": map[string]any{"accepted": !v.Downgraded, "outcome": v.Outcome, "validationNotes": v.ValidationNotes}, "ids": ids}}, true
}

func (inv *Investigation) toolError(call ToolCall, msg string) ToolResult {
	body, _ := json.Marshal(map[string]string{"error": msg})
	return ToolResult{CallID: call.ID, Content: string(body), IsError: true}
}

// validationSets collects the customer's own record ids. SeenIDs starts with the ids shown in the
// initial prompt and fills up as tools run.
func (inv *Investigation) validationSets(ctx context.Context) (entity.ValidationContext, error) {
	v := entity.ValidationContext{SeenIDs: map[string]bool{}, EntitlementIDs: map[string]bool{}, PaymentIDs: map[string]bool{}, ErrorIDs: map[string]bool{}}
	for _, id := range inv.shown {
		v.SeenIDs[id] = true
	}
	cid := inv.kase.CustomerID
	ents, err := inv.u.store.Entitlements(ctx, cid)
	if err != nil {
		return v, err
	}
	pays, err := inv.u.store.Payments(ctx, cid)
	if err != nil {
		return v, err
	}
	errs, err := inv.u.store.Errors(ctx, cid)
	if err != nil {
		return v, err
	}
	for _, e := range ents {
		v.EntitlementIDs[e.ID] = true
	}
	for _, p := range pays {
		v.PaymentIDs[p.ID] = true
	}
	for _, e := range errs {
		v.ErrorIDs[e.ID] = true
	}
	return v, nil
}

func (inv *Investigation) save(ctx context.Context, v entity.Verdict) error {
	if err := inv.u.store.SaveVerdict(ctx, inv.kase.ID, v); err != nil {
		return err
	}
	now := inv.u.now()
	if err := inv.u.store.AppendAudit(ctx, entity.AuditEntry{CaseID: inv.kase.ID, Actor: entity.ActorAI, Step: "verdict_submitted",
		Detail: fmt.Sprintf("model outcome %s, confidence %.2f, %d steps", v.ModelOutcome, v.Confidence, v.StepsUsed), At: now}); err != nil {
		return err
	}
	if v.Downgraded {
		return inv.u.store.AppendAudit(ctx, entity.AuditEntry{CaseID: inv.kase.ID, Actor: entity.ActorSystem, Step: "verdict_downgraded",
			Detail: fmt.Sprintf("→ %s: %v", v.Outcome, v.ValidationNotes), At: now})
	}
	return nil
}

// inputForEvent turns raw tool input into a JSON object for the stream ({} when empty or invalid).
func inputForEvent(raw json.RawMessage) any {
	var v map[string]any
	if json.Unmarshal(raw, &v) != nil || v == nil {
		return map[string]any{}
	}
	return v
}

func compact(raw json.RawMessage) string {
	b, err := json.Marshal(inputForEvent(raw))
	if err != nil {
		return "{}"
	}
	return string(b)
}

// errorBody maps an error to the ApiError shape for the SSE `error` event.
func errorBody(err error) (string, map[string]string) {
	code := "internal"
	msg := "Something went wrong during the investigation."
	switch {
	case isKind(err, entity.ErrLLMUnavailable):
		code, msg = "llm_unavailable", err.Error()
	case isKind(err, entity.ErrConflict):
		code, msg = "conflict", err.Error()
	case isKind(err, entity.ErrNotFound):
		code, msg = "not_found", err.Error()
	}
	return code, map[string]string{"code": code, "message": msg}
}
