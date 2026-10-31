package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// FixMaxSteps bounds the Fix-it loop.
const FixMaxSteps = 6

// FixCase runs the Fix-it agent loop: catalog tools bound to the case's customer, writes queued as plan
// steps (never executed), the last step restricted to submitFixPlan. Replay key: fix_<caseId>.
type FixCase struct {
	store InvestigationStore
	model AgentModel
	plans FixPlanStore
	now   Clock

	mu      sync.Mutex
	running map[string]bool
}

func NewFixCase(store InvestigationStore, model AgentModel, plans FixPlanStore, now Clock) *FixCase {
	return &FixCase{store: store, model: model, plans: plans, now: now, running: map[string]bool{}}
}

// Capabilities is the Fix-it catalog (GET /api/fix/capabilities).
func (u *FixCase) Capabilities() []entity.FixCapability { return FixCapabilities() }

// eligibleCase loads a case and applies S1 then F1 (409 conflict when Fix-it may not run).
func (u *FixCase) eligibleCase(ctx context.Context, caseID string) (entity.Case, error) {
	if err := checkID(caseID); err != nil {
		return entity.Case{}, err
	}
	kase, err := u.store.Case(ctx, caseID)
	if err != nil {
		return entity.Case{}, err
	}
	if g := entity.CheckFixEligible(kase.Verdict); !g.Allowed {
		return entity.Case{}, entity.Fail(entity.ErrConflict, "%s %s", g.Rule, g.Reason)
	}
	return kase, nil
}

// OpenTools binds the Fix-it tools to one eligible case (the MCP surface).
func (u *FixCase) OpenTools(ctx context.Context, caseID string) (*FixTools, error) {
	kase, err := u.eligibleCase(ctx, caseID)
	if err != nil {
		return nil, err
	}
	return newFixTools(u.store, u.plans, u.now, kase), nil
}

// FixRun is a started Fix-it run.
type FixRun struct {
	u       *FixCase
	kase    entity.Case
	tools   *FixTools
	session AgentSession
	planID  string
	Info    ModelInfo
}

// Start checks the case (400/404/409 S1/F1), takes the per-case lock (409), opens a fresh draft plan
// and the model session (503).
func (u *FixCase) Start(ctx context.Context, caseID string) (*FixRun, error) {
	kase, err := u.eligibleCase(ctx, caseID)
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
		return nil, entity.Fail(entity.ErrConflict, "Fix-it is already running for %s.", caseID)
	}
	u.running[caseID] = true
	u.mu.Unlock()

	session, info, err := u.model.Start(ctx, "fix_"+caseID, FixSystemPrompt(), FixPrompt(kase, cust), FixAgentTools())
	if err != nil {
		u.release(caseID)
		return nil, err
	}
	// A new run replaces the case's pending plan.
	draft, _ := u.plans.Update(caseID, func(entity.FixPlan, bool) (entity.FixPlan, error) { return newDraftPlan(caseID, u.now), nil })
	return &FixRun{u: u, kase: kase, session: session, Info: info, planID: draft.ID,
		tools: newFixTools(u.store, u.plans, u.now, kase)}, nil
}

func (u *FixCase) release(caseID string) {
	u.mu.Lock()
	delete(u.running, caseID)
	u.mu.Unlock()
}

// Run drives the loop and streams events (start, step, text, tool_call, tool_result, plan | error, done).
func (r *FixRun) Run(ctx context.Context, emit Emit) (plan entity.FixPlan, err error) {
	defer r.u.release(r.kase.ID)
	proposed := false
	defer func() { r.session.Close(proposed) }()

	if err := emit("start", map[string]any{"caseId": r.kase.ID, "replay": r.Info.Replay, "model": r.Info.Model,
		"maxSteps": FixMaxSteps, "mode": "fix"}); err != nil {
		return plan, err
	}
	plan, err = r.loop(ctx, emit)
	if err != nil {
		_, body := errorBody(err)
		_ = emit("error", body)
		_ = emit("done", map[string]any{})
		return plan, err
	}
	proposed = true
	if err := emit("plan", map[string]any{"plan": plan}); err != nil {
		return plan, err
	}
	return plan, emit("done", map[string]any{})
}

func (r *FixRun) loop(ctx context.Context, emit Emit) (entity.FixPlan, error) {
	var results []ToolResult
	for step := 1; step <= FixMaxSteps; step++ {
		final := step == FixMaxSteps
		if err := emit("step", map[string]any{"n": step}); err != nil {
			return entity.FixPlan{}, err
		}
		turn, err := r.session.Next(ctx, results, final)
		if err != nil {
			return entity.FixPlan{}, err
		}
		if turn.Text != "" {
			if err := emit("text", map[string]any{"delta": turn.Text}); err != nil {
				return entity.FixPlan{}, err
			}
		}
		results = nil
		for _, call := range turn.Calls {
			if err := emit("tool_call", map[string]any{"callId": call.ID, "tool": call.Name, "input": inputForEvent(call.Input)}); err != nil {
				return entity.FixPlan{}, err
			}
			var res ToolResult
			var event map[string]any
			switch {
			case call.Name == ToolSubmitFixPlan:
				plan, rejected, err := r.submit(ctx, call)
				if err != nil {
					return entity.FixPlan{}, err
				}
				if rejected == "" {
					if err := emit("tool_result", map[string]any{"callId": call.ID, "tool": call.Name,
						"output": map[string]any{"accepted": true, "planId": plan.ID, "steps": len(plan.Steps)}, "ids": []string{}}); err != nil {
						return entity.FixPlan{}, err
					}
					return plan, nil
				}
				res, event = r.problem(call, rejected)
			case final:
				res, event = r.problem(call, "Only submitFixPlan is allowed on the final step.")
			default:
				out, inputErr, err := r.tools.Run(ctx, call.Name, call.Input)
				if err != nil {
					return entity.FixPlan{}, err
				}
				if inputErr != nil {
					res, event = r.problem(call, inputErr.Error())
					break
				}
				body, err := json.Marshal(out.Output)
				if err != nil {
					return entity.FixPlan{}, err
				}
				res = ToolResult{CallID: call.ID, Content: string(body)}
				event = map[string]any{"callId": call.ID, "tool": call.Name, "output": out.Output, "ids": out.IDs}
			}
			results = append(results, res)
			if err := emit("tool_result", event); err != nil {
				return entity.FixPlan{}, err
			}
		}
	}
	return entity.FixPlan{}, entity.Fail(entity.ErrConflict, "The agent did not submit a fix plan within %d steps. Run Fix-it again.", FixMaxSteps)
}

func (r *FixRun) problem(call ToolCall, msg string) (ToolResult, map[string]any) {
	body, _ := json.Marshal(map[string]string{"error": msg})
	return ToolResult{CallID: call.ID, Content: string(body), IsError: true},
		map[string]any{"callId": call.ID, "tool": call.Name, "output": map[string]any{"error": msg}, "ids": []string{}}
}

// submit validates submitFixPlan and moves this run's draft to proposed. rejected != "": the model can fix
// it and try again. err: the plan was replaced by another run (409) or the audit failed.
func (r *FixRun) submit(ctx context.Context, call ToolCall) (plan entity.FixPlan, rejected string, err error) {
	var d entity.FixPlanDraft
	if err := decodeStrict(call.Input, &d); err != nil {
		return plan, err.Error(), nil
	}
	if err := d.Check(); err != nil {
		return plan, err.Error() + ". Fix the input and call submitFixPlan again.", nil
	}
	var replaced bool
	plan, err = r.u.plans.Update(r.kase.ID, func(cur entity.FixPlan, ok bool) (entity.FixPlan, error) {
		if !ok || cur.ID != r.planID || cur.Status != entity.PlanDraft {
			replaced = true
			return cur, entity.Fail(entity.ErrConflict, "The fix plan was replaced by another run.")
		}
		if len(cur.Steps) == 0 {
			return cur, inputErrorf("Queue at least one step (a catalog tool or %s) before submitFixPlan.", ToolNoteManualStep)
		}
		next := cur
		next.Problem, next.Summary, next.ReplyBody = strings.TrimSpace(d.Problem), strings.TrimSpace(d.Summary), strings.TrimSpace(d.ReplyBody)
		next.Status = entity.PlanProposed
		return next, nil
	})
	if replaced {
		return entity.FixPlan{}, "", err
	}
	if err != nil {
		return entity.FixPlan{}, err.Error(), nil
	}
	auto := len(plan.Steps) - plan.ManualSteps()
	if err := r.u.store.AppendAudit(ctx, entity.AuditEntry{CaseID: r.kase.ID, Actor: entity.ActorAI, Step: "fix:plan_proposed",
		Detail: fmt.Sprintf("%s · %d auto, %d manual steps", plan.ID, auto, plan.ManualSteps()), At: r.u.now()}); err != nil {
		return entity.FixPlan{}, "", err
	}
	return plan, "", nil
}
