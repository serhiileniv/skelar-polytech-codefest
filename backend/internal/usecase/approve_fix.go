package usecase

import (
	"context"
	"fmt"
	"strings"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// FixActionRunner is the single gated write path (ExecuteAction).
type FixActionRunner interface {
	Execute(ctx context.Context, caseID string, req entity.ActionRequest) (entity.ActionResult, error)
}

// FixReplier sends the support reply (ReplyToCase).
type FixReplier interface {
	Execute(ctx context.Context, caseID, body string) (entity.CaseDetail, error)
}

// ApproveFix runs the auto steps a support member selected, in plan order, each through ExecuteAction
// (gate re-evaluated against live state), stopping at the first block. Then it replies and resolves only
// when every selected step executed and no manual step is open.
type ApproveFix struct {
	plans   FixPlanStore
	actions FixActionRunner
	replies FixReplier
	store   CaseStore
	now     Clock
}

func NewApproveFix(plans FixPlanStore, actions FixActionRunner, replies FixReplier, store CaseStore, now Clock) *ApproveFix {
	return &ApproveFix{plans: plans, actions: actions, replies: replies, store: store, now: now}
}

func (u *ApproveFix) Execute(ctx context.Context, caseID, planID string, stepIDs []string) (entity.FixRunResult, error) {
	if err := checkID(caseID); err != nil {
		return entity.FixRunResult{}, err
	}
	if !entity.IDPattern.MatchString(planID) {
		return entity.FixRunResult{}, entity.Fail(entity.ErrBadRequest, "Invalid plan id.")
	}
	var selected map[string]bool
	plan, err := u.plans.Update(caseID, func(cur entity.FixPlan, ok bool) (entity.FixPlan, error) {
		if !ok || cur.ID != planID || cur.Status == entity.PlanDraft {
			return cur, entity.Fail(entity.ErrNotFound, "Fix plan %s not found for %s (it may have been replaced). Run Fix-it again.", planID, caseID)
		}
		if cur.Status != entity.PlanProposed {
			return cur, entity.Fail(entity.ErrConflict, "Fix plan %s was already approved.", planID)
		}
		var err error
		if selected, err = cur.CheckSelection(stepIDs); err != nil {
			return cur, err
		}
		next := cur
		next.Status = entity.PlanApproved
		return next, nil
	})
	if err != nil {
		return entity.FixRunResult{}, err
	}
	defer u.plans.Update(caseID, func(cur entity.FixPlan, ok bool) (entity.FixPlan, error) { //nolint:errcheck
		if ok && cur.ID == planID {
			cur.Status = entity.PlanDone
		}
		return cur, nil
	})

	var picked, notPicked []string
	for _, s := range plan.Steps {
		if s.Kind != entity.FixAuto {
			continue
		}
		if selected[s.ID] {
			picked = append(picked, s.ID)
		} else {
			notPicked = append(notPicked, s.ID)
		}
	}
	if err := u.audit(ctx, caseID, entity.ActorSupport, "fix:approved", fmt.Sprintf("%s · approved by support: [%s] · not selected: [%s] · manual open: %d",
		plan.ID, strings.Join(picked, ", "), strings.Join(notPicked, ", "), plan.ManualSteps())); err != nil {
		return entity.FixRunResult{}, err
	}

	res, err := u.runSteps(ctx, caseID, plan, selected)
	if err != nil {
		return res, err
	}
	return u.finish(ctx, caseID, plan, res)
}

// runSteps executes the selected auto steps in plan order; a block stops the run and skips the rest.
func (u *ApproveFix) runSteps(ctx context.Context, caseID string, plan entity.FixPlan, selected map[string]bool) (entity.FixRunResult, error) {
	res := entity.FixRunResult{PlanID: plan.ID, Status: "executed", Steps: []entity.FixStepRun{}}
	for _, s := range plan.Steps {
		if s.Kind != entity.FixAuto {
			continue
		}
		if !selected[s.ID] || res.Status == "stopped" {
			res.Steps = append(res.Steps, entity.FixStepRun{StepID: s.ID, Status: "skipped"})
			continue
		}
		out, err := u.actions.Execute(ctx, caseID, entity.ActionRequest{Kind: entity.KindSupportAction, Action: s.Action})
		if err != nil {
			return res, err
		}
		res.Steps = append(res.Steps, entity.FixStepRun{StepID: s.ID, Status: out.Status, Result: &out})
		if out.Status != "executed" {
			res.Status = "stopped"
		}
	}
	return res, nil
}

// finish replies, then resolves or keeps the case open, and audits the outcome.
func (u *ApproveFix) finish(ctx context.Context, caseID string, plan entity.FixPlan, res entity.FixRunResult) (entity.FixRunResult, error) {
	if res.Status == "executed" {
		if _, err := u.replies.Execute(ctx, caseID, plan.ReplyBody); err != nil {
			return res, err
		}
		res.Replied = true
	}
	if res.Status == "executed" && plan.ManualSteps() == 0 {
		out, err := u.actions.Execute(ctx, caseID, entity.ActionRequest{Kind: entity.KindMarkResolved})
		if err != nil {
			return res, err
		}
		res.Resolved = out.Status == "executed"
	} else if err := u.keepOpen(ctx, caseID); err != nil {
		return res, err
	}
	step := "fix:completed"
	if res.Status == "stopped" {
		step = "fix:stopped"
	}
	var parts []string
	for _, s := range res.Steps {
		parts = append(parts, s.StepID+"="+s.Status)
	}
	return res, u.audit(ctx, caseID, entity.ActorSystem, step, fmt.Sprintf("%s · %s · replied=%v resolved=%v",
		plan.ID, strings.Join(parts, ", "), res.Replied, res.Resolved))
}

// keepOpen undoes the per-action auto-resolve when work is left (a block, an unselected step or a manual step).
func (u *ApproveFix) keepOpen(ctx context.Context, caseID string) error {
	return u.store.InTx(ctx, func(tx CaseTx) error {
		kase, err := tx.LockCase(ctx, caseID)
		if err != nil || kase.Status != entity.CaseResolved {
			return err
		}
		return tx.SetCaseStatus(ctx, caseID, entity.CaseWaitingCustomer)
	})
}

func (u *ApproveFix) audit(ctx context.Context, caseID string, actor entity.Actor, step, detail string) error {
	return u.store.InTx(ctx, func(tx CaseTx) error {
		return tx.AppendAudit(ctx, entity.AuditEntry{CaseID: caseID, Actor: actor, Step: step, Detail: detail, At: u.now()})
	})
}
