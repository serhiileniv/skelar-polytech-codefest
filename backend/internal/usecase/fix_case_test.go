package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/repo/memory"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/seed"
)

func fixClock() time.Time { return seed.Now }

// storeWithVerdict is the seed world with a verdict set on one case.
func storeWithVerdict(caseID string, v *entity.Verdict) *fakeStore {
	f := newFakeStore()
	for i := range f.w.Cases {
		if f.w.Cases[i].ID == caseID {
			f.w.Cases[i].Verdict = v
		}
	}
	return f
}

func fixable() *entity.Verdict {
	return &entity.Verdict{Outcome: entity.OutcomeUserCanFix, Summary: "App deleted, sub_0001 still active", Evidence: []entity.Evidence{{ID: "sub_0001", Note: "active"}}}
}

func TestFixLoopQueuesPlanWithoutWriting(t *testing.T) {
	store := storeWithVerdict("case_101", fixable())
	plans := memory.NewFixPlans()
	model := &scriptedModel{turns: []Turn{
		{Text: "Read the case.", Calls: []ToolCall{call("c1", ToolGetCase, `{}`), call("c2", ToolGetBilling, `{}`)}},
		{Text: "Cancel the App Store sub.", Calls: []ToolCall{call("c3", ToolCancelSubscription, `{"subscriptionId":"sub_0001","reason":"App deleted, still billed"}`)}},
		{Text: "Try another customer's sub.", Calls: []ToolCall{call("c4", ToolCancelSubscription, `{"subscriptionId":"sub_0002","reason":"wrong target"}`)}},
		{Text: "Customer confirms in Apple ID.", Calls: []ToolCall{call("c5", ToolNoteManualStep, `{"owner":"customer","title":"Confirm in Apple ID","detail":"Check Settings > Subscriptions shows it canceled."}`)}},
		{Text: "Submitting too early with a bad body.", Calls: []ToolCall{call("c6", ToolSubmitFixPlan, `{"problem":"short","summary":"x","replyBody":"hi"}`)}},
		{Text: "Final.", Calls: []ToolCall{
			call("c7", ToolRefundPayment, `{"paymentId":"pay_0001","reason":"not allowed on the final step"}`),
			call("c8", ToolSubmitFixPlan, `{"problem":"sub_0001 renews although the app was deleted (ev_0001).","summary":"Cancel sub_0001; customer confirms.","replyBody":"Hi Emma, we canceled your subscription; you will not be charged again."}`),
		}},
	}}
	u := NewFixCase(store, model, plans, fixClock)

	run, err := u.Start(context.Background(), "case_101")
	if err != nil {
		t.Fatal(err)
	}
	evs, emit := collectEvents()
	plan, err := run.Run(context.Background(), emit)
	if err != nil {
		t.Fatal(err)
	}

	// The last step offers only submitFixPlan; earlier steps do not.
	if len(model.finals) != FixMaxSteps || !model.finals[FixMaxSteps-1] || model.finals[0] {
		t.Fatalf("finals = %v", model.finals)
	}
	if !model.closed || !model.succeeded {
		t.Fatal("session not closed as succeeded")
	}
	// Plan: own sub executed-preview, foreign sub A1 blocked, manual step; refund on final step rejected.
	if len(plan.Steps) != 3 {
		t.Fatalf("steps = %+v", plan.Steps)
	}
	if s := plan.Steps[0]; s.Kind != entity.FixAuto || s.Owner != entity.OwnerAgent || s.Actor != entity.ActorOnBehalfOfCustomer || s.WouldBe != "executed" || s.Rule != entity.RuleCancel {
		t.Fatalf("step 1 = %+v", s)
	}
	if s := plan.Steps[1]; s.WouldBe != "blocked" || s.Rule != entity.RuleOwnRecords {
		t.Fatalf("step 2 = %+v", s)
	}
	if s := plan.Steps[2]; s.Kind != entity.FixManual || s.Owner != entity.OwnerCustomer {
		t.Fatalf("step 3 = %+v", s)
	}
	if plan.Problem == "" || plan.Summary == "" || plan.ReplyBody == "" || plan.Status != entity.PlanProposed {
		t.Fatalf("plan = %+v", plan)
	}
	// Nothing written: no verdict saved, sub_0001 still active.
	if len(store.saved) != 0 {
		t.Fatal("verdict saved during Fix-it")
	}
	for _, s := range store.w.Subscriptions {
		if s.ID == "sub_0001" && s.Status != entity.SubscriptionActive {
			t.Fatal("sub_0001 changed before approval")
		}
	}
	// Every read was scoped to the case's customer.
	for _, id := range store.scopedTo {
		if id != "cust_001" {
			t.Fatalf("read scoped to %s", id)
		}
	}
	// Event order: start(mode fix) … plan, done.
	names := []string{}
	for _, e := range *evs {
		names = append(names, e.name)
	}
	if names[0] != "start" || names[len(names)-2] != "plan" || names[len(names)-1] != "done" {
		t.Fatalf("events %v", names)
	}
	if (*evs)[0].data.(map[string]any)["mode"] != "fix" {
		t.Fatal("start event without mode fix")
	}
	if !hasAudit(store.audit, "fix:plan_proposed") || !hasAudit(store.audit, "tool:cancelSubscription") {
		t.Fatalf("audit %+v", store.audit)
	}
}

func hasAudit(entries []entity.AuditEntry, step string) bool {
	for _, e := range entries {
		if e.Step == step {
			return true
		}
	}
	return false
}

func TestFixLoopNoPlanIsAnError(t *testing.T) {
	u := NewFixCase(storeWithVerdict("case_101", fixable()), &scriptedModel{}, memory.NewFixPlans(), fixClock)
	run, err := u.Start(context.Background(), "case_101")
	if err != nil {
		t.Fatal(err)
	}
	evs, emit := collectEvents()
	if _, err := run.Run(context.Background(), emit); !errors.Is(err, entity.ErrConflict) {
		t.Fatalf("err = %v", err)
	}
	if n := len(*evs); (*evs)[n-2].name != "error" || (*evs)[n-1].name != "done" {
		t.Fatalf("events %+v", *evs)
	}
}

func TestFixStartEligibility(t *testing.T) {
	tests := []struct {
		name    string
		verdict *entity.Verdict
		wantErr error
	}{
		{"fixable", fixable(), nil},
		{"not investigated", nil, entity.ErrConflict},
		{"tech_team", &entity.Verdict{Outcome: entity.OutcomeTechTeam}, entity.ErrConflict},
		{"suspicious", &entity.Verdict{Outcome: entity.OutcomeSuspicious}, entity.ErrConflict},
		{"downgraded", &entity.Verdict{Outcome: entity.OutcomeSupportCanFix, Downgraded: true}, entity.ErrConflict},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			u := NewFixCase(storeWithVerdict("case_101", tt.verdict), &scriptedModel{}, memory.NewFixPlans(), fixClock)
			_, err := u.Start(context.Background(), "case_101")
			if !errors.Is(err, tt.wantErr) && !(tt.wantErr == nil && err == nil) {
				t.Fatalf("err = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestFixToolsRejectDuplicatesAndBadInput(t *testing.T) {
	u := NewFixCase(storeWithVerdict("case_101", fixable()), &scriptedModel{}, memory.NewFixPlans(), fixClock)
	tools, err := u.OpenTools(context.Background(), "case_101")
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name      string
		tool      string
		input     string
		wantInErr bool
	}{
		{"cancel", ToolCancelSubscription, `{"subscriptionId":"sub_0001","reason":"app deleted"}`, false},
		{"same cancel twice", ToolCancelSubscription, `{"subscriptionId":"sub_0001","reason":"again"}`, true},
		{"wrong id field", ToolCancelSubscription, `{"paymentId":"pay_0001","reason":"wrong field"}`, true},
		{"unknown field", ToolSendMagicLink, `{"reason":"lost","customerId":"cust_002"}`, true},
		{"bad owner", ToolNoteManualStep, `{"owner":"agent","title":"Do it","detail":"Something"}`, true},
		{"tech owner rejected", ToolNoteManualStep, `{"owner":"tech","title":"Fix the bug","detail":"Add the key"}`, true},
		{"support owner rejected", ToolNoteManualStep, `{"owner":"support","title":"Edit config","detail":"Flip the flag"}`, true},
		{"customer owner", ToolNoteManualStep, `{"owner":"customer","title":"Confirm in Apple ID","detail":"Settings → Subscriptions"}`, false},
		{"ticket without evidence", ToolCreateTechTicket, `{"title":"Cancel not synced","rootCause":"err_0002 shows the sync timed out.","evidence":[]}`, true},
		{"ticket", ToolCreateTechTicket, `{"title":"Cancel not synced","rootCause":"err_0002 shows the sync timed out.","signature":"cancel_not_synced","evidence":[{"id":"msg_0001","note":"customer report"}]}`, false},
		{"second ticket", ToolCreateTechTicket, `{"title":"Cancel again","rootCause":"err_0002 shows the sync timed out.","signature":"cancel_not_synced","evidence":[{"id":"msg_0001","note":"customer report"}]}`, true},
		{"submit is loop only", ToolSubmitFixPlan, `{}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, inErr, err := tools.Run(context.Background(), tt.tool, json.RawMessage(tt.input))
			if err != nil || (inErr != nil) != tt.wantInErr {
				t.Fatalf("inErr=%v err=%v, wantInErr %v", inErr, err, tt.wantInErr)
			}
		})
	}
}

func TestFixTicketDryRun(t *testing.T) {
	supportFix := &entity.Verdict{Outcome: entity.OutcomeSupportCanFix, Summary: "pay_0006 duplicates pay_0005"}
	input := `{"title":"Renewal retry without idempotency key","rootCause":"err_0003: retry for sub_0006 had no idempotency key and created pay_0006.",
		"evidence":[{"id":"err_0003","note":"retry without idempotency key"},{"id":"pay_0006","note":"duplicate charge"}]}`
	tests := []struct {
		name        string
		input       string
		board       []entity.TechIssue
		wantWouldBe string
		wantPreview string
	}{
		{"err evidence, no open ticket → executed", input, nil, "executed", "err_0003"},
		{"open ticket for the case → blocked", input, []entity.TechIssue{{ID: "tech_0001", CaseIDs: []string{"case_105"}, Status: entity.TechIssueNew}}, "blocked", "tech_0001"},
		{"resolved ticket does not count", input, []entity.TechIssue{{ID: "tech_0001", CaseIDs: []string{"case_105"}, Status: entity.TechIssueResolved}}, "executed", "err_0003"},
		{"no error log cited → blocked", `{"title":"Duplicate charge","rootCause":"pay_0006 duplicates pay_0005 on sub_0006.","signature":"duplicate_charge",
			"evidence":[{"id":"pay_0006","note":"duplicate charge"}]}`, nil, "blocked", "err_*"},
		{"another customer's record → blocked", `{"title":"Duplicate charge","rootCause":"err_0003 shows a retry without key.",
			"evidence":[{"id":"err_0003","note":"retry"},{"id":"pay_0001","note":"not this customer"}]}`, nil, "blocked", "pay_0001"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := storeWithVerdict("case_105", supportFix)
			store.board = tt.board
			u := NewFixCase(store, &scriptedModel{}, memory.NewFixPlans(), fixClock)
			tools, err := u.OpenTools(context.Background(), "case_105")
			if err != nil {
				t.Fatal(err)
			}
			out, inErr, err := tools.Run(context.Background(), ToolCreateTechTicket, json.RawMessage(tt.input))
			if err != nil || inErr != nil {
				t.Fatalf("inErr=%v err=%v", inErr, err)
			}
			got := out.Output.(map[string]any)
			if got["wouldBe"] != tt.wantWouldBe || got["rule"] != entity.RuleTechTicket || !strings.Contains(got["previewMessage"].(string), tt.wantPreview) {
				t.Fatalf("output %+v", got)
			}
		})
	}
}

func TestFixTicketInfersSignatureFromErrorLog(t *testing.T) {
	store := storeWithVerdict("case_105", &entity.Verdict{Outcome: entity.OutcomeSupportCanFix})
	plans := memory.NewFixPlans()
	tools, err := NewFixCase(store, &scriptedModel{}, plans, fixClock).OpenTools(context.Background(), "case_105")
	if err != nil {
		t.Fatal(err)
	}
	if _, inErr, err := tools.Run(context.Background(), ToolCreateTechTicket, json.RawMessage(
		`{"title":"Renewal retry without key","rootCause":"err_0003: retry created pay_0006.","evidence":[{"id":"err_0003","note":"retry"}]}`)); err != nil || inErr != nil {
		t.Fatalf("inErr=%v err=%v", inErr, err)
	}
	plan, _ := plans.Update("case_105", func(p entity.FixPlan, _ bool) (entity.FixPlan, error) { return p, nil })
	if len(plan.Steps) != 1 || plan.Steps[0].Ticket == nil || plan.Steps[0].Ticket.Signature != entity.SignatureDuplicateCharge {
		t.Fatalf("steps %+v", plan.Steps)
	}
}
