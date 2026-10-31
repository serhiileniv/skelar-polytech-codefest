package usecase

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/repo/memory"
)

// fakeRunner answers each support action by its target with a scripted status and records the calls.
type fakeRunner struct {
	blocked map[string]bool
	calls   []string
}

func (r *fakeRunner) Execute(_ context.Context, _ string, req entity.ActionRequest) (entity.ActionResult, error) {
	name := req.Name()
	if req.Action != nil {
		name = req.Action.Target()
	}
	r.calls = append(r.calls, name)
	if r.blocked[name] {
		return entity.ActionResult{Status: "blocked", Rule: "P1"}, nil
	}
	return entity.ActionResult{Status: "executed", Rule: "-"}, nil
}

type fakeReplier struct{ bodies []string }

func (r *fakeReplier) Execute(_ context.Context, _ string, body string) (entity.CaseDetail, error) {
	r.bodies = append(r.bodies, body)
	return entity.CaseDetail{}, nil
}

// fakeTx implements only what ApproveFix uses; other CaseTx methods panic (nil embedded interface).
type fakeTx struct {
	CaseTx
	status entity.CaseStatus
	audit  []entity.AuditEntry
}

func (t *fakeTx) LockCase(context.Context, string) (entity.Case, error) {
	return entity.Case{Status: t.status}, nil
}
func (t *fakeTx) SetCaseStatus(_ context.Context, _ string, s entity.CaseStatus) error {
	t.status = s
	return nil
}
func (t *fakeTx) AppendAudit(_ context.Context, e entity.AuditEntry) error {
	t.audit = append(t.audit, e)
	return nil
}

type fakeCaseStore struct{ tx *fakeTx }

func (s fakeCaseStore) InTx(_ context.Context, fn func(CaseTx) error) error { return fn(s.tx) }

func autoStep(id, target string) entity.FixStep {
	return entity.FixStep{ID: id, Kind: entity.FixAuto, Owner: entity.OwnerAgent,
		Action: &entity.SupportAction{Type: entity.ActionRefundPayment, PaymentID: target, Reason: "dup"}}
}

func ticketStep(id string) entity.FixStep {
	return entity.FixStep{ID: id, Kind: entity.FixAuto, Owner: entity.OwnerAgent, Tool: ToolCreateTechTicket,
		Ticket: &entity.TechTicketDraft{Title: "Duplicate renewal", RootCause: "err_0003 shows a retry without idempotency key.",
			Signature: entity.SignatureDuplicateCharge, Evidence: []entity.Evidence{{ID: "err_0003", Note: "retry without key"}}}}
}

func proposed(steps ...entity.FixStep) entity.FixPlan {
	return entity.FixPlan{ID: "plan_1", CaseID: "case_105", Steps: steps, ReplyBody: "Done for you.", Status: entity.PlanProposed}
}

func TestApproveFixRunsSelectedStepsInOrder(t *testing.T) {
	manual := entity.FixStep{ID: "step_9", Kind: entity.FixManual, Owner: entity.OwnerCustomer}
	tests := []struct {
		name         string
		plan         entity.FixPlan
		selected     []string
		blocked      map[string]bool
		wantStatus   string
		wantSteps    []string // per auto step, plan order
		wantCalls    []string
		wantReplied  bool
		wantResolved bool
		wantCase     entity.CaseStatus
	}{
		{"all executed, no manual → resolved", proposed(autoStep("step_1", "pay_a"), autoStep("step_2", "pay_b")), []string{"step_2", "step_1"}, nil,
			"executed", []string{"executed", "executed"}, []string{"pay_a", "pay_b", "mark_resolved"}, true, true, entity.CaseResolved},
		{"stop at first block, rest skipped", proposed(autoStep("step_1", "pay_a"), autoStep("step_2", "pay_b"), autoStep("step_3", "pay_c")), []string{"step_1", "step_2", "step_3"}, map[string]bool{"pay_b": true},
			"stopped", []string{"executed", "blocked", "skipped"}, []string{"pay_a", "pay_b"}, false, false, entity.CaseWaitingCustomer},
		{"manual step open → reply, not resolved", proposed(autoStep("step_1", "pay_a"), manual), []string{"step_1"}, nil,
			"executed", []string{"executed"}, []string{"pay_a"}, true, false, entity.CaseWaitingCustomer},
		{"refund + tech ticket, no manual → resolved", proposed(autoStep("step_1", "pay_a"), ticketStep("step_2")), []string{"step_1", "step_2"}, nil,
			"executed", []string{"executed", "executed"}, []string{"pay_a", "create_tech_ticket", "mark_resolved"}, true, true, entity.CaseResolved},
		{"tech ticket + customer step → waiting_customer", proposed(ticketStep("step_1"), manual), []string{"step_1"}, nil,
			"executed", []string{"executed"}, []string{"create_tech_ticket"}, true, false, entity.CaseWaitingCustomer},
		{"unselected step skipped", proposed(autoStep("step_1", "pay_a"), autoStep("step_2", "pay_b")), []string{"step_2"}, nil,
			"executed", []string{"skipped", "executed"}, []string{"pay_b", "mark_resolved"}, true, true, entity.CaseResolved},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			plans := memory.NewFixPlans()
			_, _ = plans.Update("case_105", func(entity.FixPlan, bool) (entity.FixPlan, error) { return tt.plan, nil })
			runner := &fakeRunner{blocked: tt.blocked}
			replier := &fakeReplier{}
			// The fake runner does not change status; start "resolved" as ExecuteAction leaves it after a support action.
			tx := &fakeTx{status: entity.CaseResolved}
			u := NewApproveFix(plans, runner, replier, fakeCaseStore{tx}, fixClock)

			res, err := u.Execute(context.Background(), "case_105", "plan_1", tt.selected)
			if err != nil {
				t.Fatal(err)
			}
			var got []string
			for _, s := range res.Steps {
				got = append(got, s.Status)
			}
			if res.Status != tt.wantStatus || !slices.Equal(got, tt.wantSteps) || !slices.Equal(runner.calls, tt.wantCalls) {
				t.Fatalf("status=%s steps=%v calls=%v", res.Status, got, runner.calls)
			}
			if res.Replied != tt.wantReplied || (len(replier.bodies) == 1) != tt.wantReplied || res.Resolved != tt.wantResolved {
				t.Fatalf("replied=%v resolved=%v bodies=%v", res.Replied, res.Resolved, replier.bodies)
			}
			if tx.status != tt.wantCase {
				t.Fatalf("case status %s, want %s", tx.status, tt.wantCase)
			}
			if len(tx.audit) != 2 || tx.audit[0].Step != "fix:approved" || tx.audit[0].Actor != entity.ActorSupport {
				t.Fatalf("audit %+v", tx.audit)
			}
			wantLast := "fix:completed"
			if tt.wantStatus == "stopped" {
				wantLast = "fix:stopped"
			}
			if tx.audit[1].Step != wantLast {
				t.Fatalf("last audit %s", tx.audit[1].Step)
			}
		})
	}
}

func TestApproveFixRequestErrors(t *testing.T) {
	plans := memory.NewFixPlans()
	plan := proposed(autoStep("step_1", "pay_a"), entity.FixStep{ID: "step_2", Kind: entity.FixManual})
	_, _ = plans.Update("case_105", func(entity.FixPlan, bool) (entity.FixPlan, error) { return plan, nil })
	u := NewApproveFix(plans, &fakeRunner{}, &fakeReplier{}, fakeCaseStore{&fakeTx{}}, fixClock)
	ctx := context.Background()

	if _, err := u.Execute(ctx, "case_105", "plan_other", []string{"step_1"}); !errors.Is(err, entity.ErrNotFound) {
		t.Fatalf("stale plan: %v", err)
	}
	if _, err := u.Execute(ctx, "case_105", "plan_1", []string{"step_2"}); !errors.Is(err, entity.ErrBadRequest) {
		t.Fatalf("manual step selected: %v", err)
	}
	if _, err := u.Execute(ctx, "case_105", "plan_1", []string{"step_1"}); err != nil {
		t.Fatalf("first approve: %v", err)
	}
	if _, err := u.Execute(ctx, "case_105", "plan_1", []string{"step_1"}); !errors.Is(err, entity.ErrConflict) {
		t.Fatalf("second approve: %v", err)
	}
}
