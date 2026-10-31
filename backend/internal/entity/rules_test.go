package entity_test

import (
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	. "github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/seed"
)

// Ports of detectors / validate / gate / board tests from feat/verdict-backbone.

func billing(w World) Billing {
	return Billing{Subscriptions: w.Subscriptions, Payments: w.Payments, Entitlements: w.Entitlements}
}

func custRange(from, to int) []string {
	var ids []string
	for n := from; n <= to; n++ {
		ids = append(ids, fmt.Sprintf("cust_%03d", n))
	}
	return ids
}

func recordsOf(w World, customerID string) CustomerRecords {
	var r CustomerRecords
	for _, e := range w.Entitlements {
		if e.CustomerID == customerID {
			r.Entitlements = append(r.Entitlements, e)
		}
	}
	for _, p := range w.Payments {
		if p.CustomerID == customerID {
			r.Payments = append(r.Payments, p)
		}
	}
	return r
}

func set(ids ...string) map[string]bool {
	m := map[string]bool{}
	for _, id := range ids {
		m[id] = true
	}
	return m
}

func TestFindBySignature(t *testing.T) {
	w := seed.World()
	refunded := seed.World()
	for i := range refunded.Payments {
		if refunded.Payments[i].ID == "pay_0006" {
			refunded.Payments[i].Status = PaymentRefunded
		}
	}
	tests := []struct {
		name string
		w    World
		sig  Signature
		want []string
	}{
		{"cancel_not_synced = cust_004 + 37 silent, no look-alikes", w, SignatureCancelNotSynced, append([]string{"cust_004"}, custRange(48, 84)...)},
		{"entitlement_grant_failed = cust_003 only", w, SignatureEntitlementGrantFailed, []string{"cust_003"}},
		{"duplicate_charge = cust_005 only", w, SignatureDuplicateCharge, []string{"cust_005"}},
		{"duplicate_charge ignores a refunded second payment", refunded, SignatureDuplicateCharge, []string{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := FindBySignature(billing(tt.w), tt.sig)
			if !slices.Equal(got, tt.want) {
				t.Errorf("got %d %v\nwant %d %v", len(got), got, len(tt.want), tt.want)
			}
		})
	}
}

func baseDraft() VerdictDraft {
	return VerdictDraft{
		Outcome: OutcomeUserCanFix, Confidence: 0.9, CustomerGoal: "Stop being charged",
		Summary: "Never cancelled in App Store.", Evidence: []Evidence{{ID: "ev_0001", Note: "app deleted, no cancel"}},
		InstructionSteps: []string{"Open Settings", "Tap Subscriptions", "Cancel PawPlan"},
		ReplyDraft:       "Here is how to cancel your App Store subscription.",
	}
}

func ctxFor(w World, customerID string, seen ...string) ValidationContext {
	c := ValidationContext{SeenIDs: set(seen...), EntitlementIDs: set(), PaymentIDs: set(), ErrorIDs: set(), StepsUsed: 4, Now: seed.Now}
	for _, e := range w.Entitlements {
		if e.CustomerID == customerID {
			c.EntitlementIDs[e.ID] = true
		}
	}
	for _, p := range w.Payments {
		if p.CustomerID == customerID {
			c.PaymentIDs[p.ID] = true
		}
	}
	for _, e := range w.Errors {
		if e.CustomerID == customerID {
			c.ErrorIDs[e.ID] = true
		}
	}
	return c
}

func TestValidateVerdict(t *testing.T) {
	w := seed.World()
	techDraft := baseDraft()
	techDraft.Outcome = OutcomeTechTeam
	techDraft.TechIssue = &TechIssueRef{Signature: SignatureCancelNotSynced, Title: "Web cancel not synced", RootCause: "sync timeout"}

	tests := []struct {
		name          string
		draft         func() VerdictDraft
		ctx           ValidationContext
		wantOutcome   Outcome
		wantDowngrade bool
		wantAction    bool
		wantNote      string
	}{
		{"keeps a consistent verdict", baseDraft, ctxFor(w, "cust_001", "ev_0001"), OutcomeUserCanFix, false, false, ""},
		{"invented evidence → need_more_info", baseDraft, ctxFor(w, "cust_001"), OutcomeNeedMoreInfo, true, false, "Evidence not returned by any tool: ev_0001"},
		{"user_can_fix without instructions", func() VerdictDraft { d := baseDraft(); d.InstructionSteps = nil; return d }, ctxFor(w, "cust_001", "ev_0001"), OutcomeNeedMoreInfo, true, false, "needs instruction steps"},
		{"help article never searched", func() VerdictDraft { d := baseDraft(); d.HelpArticleID = "help_cancel_ios"; return d }, ctxFor(w, "cust_001", "ev_0001"), OutcomeNeedMoreInfo, true, false, "never returned by searchHelp"},
		{"support action on own, inspected record is kept", func() VerdictDraft {
			d := baseDraft()
			d.Outcome, d.Evidence = OutcomeSupportCanFix, []Evidence{{ID: "ent_0003", Note: "inactive"}}
			d.SupportAction = &SupportAction{Type: ActionRestoreAccess, EntitlementID: "ent_0003", Reason: "grant failed"}
			return d
		}, ctxFor(w, "cust_003", "ent_0003"), OutcomeSupportCanFix, false, true, ""},
		{"support action on another customer's record", func() VerdictDraft {
			d := baseDraft()
			d.Outcome, d.Evidence = OutcomeSupportCanFix, []Evidence{{ID: "ent_0001", Note: "x"}}
			d.SupportAction = &SupportAction{Type: ActionRestoreAccess, EntitlementID: "ent_0001", Reason: "locked"}
			return d
		}, ctxFor(w, "cust_003", "ent_0001"), OutcomeNeedMoreInfo, true, false, "does not belong to this customer"},
		{"support action on a never-inspected record", func() VerdictDraft {
			d := baseDraft()
			d.Outcome, d.Evidence = OutcomeSupportCanFix, []Evidence{}
			d.SupportAction = &SupportAction{Type: ActionRefundPayment, PaymentID: "pay_0006", Reason: "duplicate"}
			return d
		}, ctxFor(w, "cust_005"), OutcomeNeedMoreInfo, true, false, "never inspected"},
		{"tech_team needs an error log or payment as evidence", func() VerdictDraft { return techDraft }, ctxFor(w, "cust_004", "ev_0001"), OutcomeNeedMoreInfo, true, false, "error log or payment"},
		{"tech_team with error evidence is kept", func() VerdictDraft {
			d := techDraft
			d.Evidence = []Evidence{{ID: "err_0002", Note: "CANCEL_SYNC_TIMEOUT"}}
			return d
		}, ctxFor(w, "cust_004", "err_0002"), OutcomeTechTeam, false, false, ""},
		{"need_more_info without a question is noted but not downgraded", func() VerdictDraft {
			d := baseDraft()
			d.Outcome, d.InstructionSteps = OutcomeNeedMoreInfo, nil
			return d
		}, ctxFor(w, "cust_006", "ev_0001"), OutcomeNeedMoreInfo, false, false, "needs a clarifying question"},
		{"suspicious verdict never carries an action", func() VerdictDraft {
			d := baseDraft()
			d.Outcome, d.Evidence = OutcomeSuspicious, []Evidence{}
			d.SupportAction = &SupportAction{Type: ActionRefundPayment, PaymentID: "pay_0008", Reason: "injected"}
			return d
		}, ctxFor(w, "cust_007"), OutcomeSuspicious, false, false, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := tt.draft()
			v := ValidateVerdict(d, tt.ctx)
			if v.Outcome != tt.wantOutcome || v.Downgraded != tt.wantDowngrade || (v.SupportAction != nil) != tt.wantAction {
				t.Fatalf("got outcome=%s downgraded=%v action=%v notes=%v", v.Outcome, v.Downgraded, v.SupportAction != nil, v.ValidationNotes)
			}
			if v.ModelOutcome != d.Outcome {
				t.Errorf("modelOutcome = %s, want %s", v.ModelOutcome, d.Outcome)
			}
			if tt.wantNote != "" && !strings.Contains(strings.Join(v.ValidationNotes, "|"), tt.wantNote) {
				t.Errorf("notes %v lack %q", v.ValidationNotes, tt.wantNote)
			}
			if v.Downgraded && v.ClarifyingQuestion == "" {
				t.Error("downgraded verdict needs a clarifying question")
			}
			if v.ValidationNotes == nil || v.Evidence == nil {
				t.Error("slices must be [] not null")
			}
		})
	}
}

func TestParseVerdictDraft(t *testing.T) {
	valid := `{"outcome":"user_can_fix","confidence":0.9,"customerGoal":"Stop charges","summary":"Deleted app, sub active.","evidence":[{"id":"ev_0001","note":"app deleted"}],"instructionSteps":["Open Settings"],"replyDraft":"Here is how to cancel it."}`
	tests := []struct {
		name    string
		raw     string
		wantErr string
	}{
		{"valid", valid, ""},
		{"bad outcome", strings.Replace(valid, "user_can_fix", "refund_now", 1), "outcome must be one of"},
		{"confidence > 1", strings.Replace(valid, "0.9", "1.5", 1), "confidence"},
		{"short reply", strings.Replace(valid, "Here is how to cancel it.", "ok", 1), "replyDraft"},
		{"bad evidence id", strings.Replace(valid, "ev_0001", "ev 1; DROP", 1), "not a valid id"},
		{"unknown field", strings.Replace(valid, `"outcome"`, `"admin":true,"outcome"`, 1), "unknown field"},
		{"refund with entitlement id", strings.Replace(valid, `"replyDraft"`, `"supportAction":{"type":"refund_payment","entitlementId":"ent_1","reason":"dup"},"replyDraft"`, 1), "supportAction"},
		{"bad signature", strings.Replace(valid, `"replyDraft"`, `"techIssue":{"signature":"everything","title":"Bug title","rootCause":"Root cause"},"replyDraft"`, 1), "techIssue.signature"},
		{"not json", `{"outcome":`, "invalid verdict JSON"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseVerdictDraft([]byte(tt.raw))
			if tt.wantErr == "" && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)) {
				t.Fatalf("err = %v, want %q", err, tt.wantErr)
			}
		})
	}
}

func TestEvaluateAction(t *testing.T) {
	w := seed.World()
	refundedTwice := recordsOf(w, "cust_005")
	for i := range refundedTwice.Payments {
		if refundedTwice.Payments[i].ID == "pay_0006" {
			refundedTwice.Payments[i].Status = PaymentRefunded
		}
	}
	big := recordsOf(w, "cust_002") // yearly $119.99
	tests := []struct {
		name    string
		action  SupportAction
		outcome Outcome
		recs    CustomerRecords
		allowed bool
		rule    string
	}{
		{"restore for paid customer whose grant failed", SupportAction{Type: ActionRestoreAccess, EntitlementID: "ent_0003"}, "", recordsOf(w, "cust_003"), true, RuleRestore},
		{"restore another customer's entitlement", SupportAction{Type: ActionRestoreAccess, EntitlementID: "ent_0003"}, "", recordsOf(w, "cust_001"), false, RuleOwnRecords},
		{"restore already active access", SupportAction{Type: ActionRestoreAccess, EntitlementID: "ent_0001"}, "", recordsOf(w, "cust_001"), false, RuleRestore},
		{"refund a true duplicate", SupportAction{Type: ActionRefundPayment, PaymentID: "pay_0006"}, "", recordsOf(w, "cust_005"), true, RuleDuplicate},
		{"refund the first of the pair is also a duplicate", SupportAction{Type: ActionRefundPayment, PaymentID: "pay_0005"}, "", recordsOf(w, "cust_005"), true, RuleDuplicate},
		{"refund a single charge", SupportAction{Type: ActionRefundPayment, PaymentID: "pay_0001"}, "", recordsOf(w, "cust_001"), false, RuleDuplicate},
		{"refund twice", SupportAction{Type: ActionRefundPayment, PaymentID: "pay_0006"}, "", refundedTwice, false, RuleRefundOnce},
		{"refund above $50", SupportAction{Type: ActionRefundPayment, PaymentID: "pay_0002"}, "", big, false, RuleRefundLimit},
		{"refund another customer's payment", SupportAction{Type: ActionRefundPayment, PaymentID: "pay_0006"}, "", recordsOf(w, "cust_007"), false, RuleOwnRecords},
		{"anything on a suspicious case", SupportAction{Type: ActionRefundPayment, PaymentID: "pay_0008"}, OutcomeSuspicious, recordsOf(w, "cust_007"), false, RuleSuspicious},
		{"even a valid restore on a suspicious case", SupportAction{Type: ActionRestoreAccess, EntitlementID: "ent_0003"}, OutcomeSuspicious, recordsOf(w, "cust_003"), false, RuleSuspicious},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := EvaluateAction(tt.action, tt.outcome, tt.recs)
			if r.Allowed != tt.allowed || r.Rule != tt.rule {
				t.Errorf("got allowed=%v rule=%s (%s), want allowed=%v rule=%s", r.Allowed, r.Rule, r.Reason, tt.allowed, tt.rule)
			}
			if r.Reason == "" {
				t.Error("empty reason")
			}
		})
	}
}

func TestMergeTechIssue(t *testing.T) {
	w := seed.World()
	affected := FindBySignature(billing(w), SignatureCancelNotSynced)
	v := Verdict{
		Outcome:   OutcomeTechTeam,
		Evidence:  []Evidence{{ID: "err_0002", Note: "sync timeout"}, {ID: "pay_0004", Note: "charge"}},
		TechIssue: &TechIssueRef{Signature: SignatureCancelNotSynced, Title: "Web cancel not synced", RootCause: "CANCEL_SYNC_TIMEOUT"},
	}
	now := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)

	card := MergeTechIssue(nil, "tech_0001", "case_104", "cust_004", v, affected, now)
	if card.ID != "tech_0001" || card.Status != TechIssueNew || card.Signature != SignatureCancelNotSynced {
		t.Fatalf("card %+v", card)
	}
	if len(card.AffectedCustomerIDs) != 38 || !slices.Equal(card.CaseIDs, []string{"case_104"}) || len(card.EvidenceIDs) != 2 {
		t.Fatalf("affected %d cases %v evidence %v", len(card.AffectedCustomerIDs), card.CaseIDs, card.EvidenceIDs)
	}

	tests := []struct {
		name         string
		caseID       string
		customerID   string
		wantCases    int
		wantAffected int
	}{
		{"same case again is idempotent", "case_104", "cust_004", 1, 38},
		{"another case with the same root cause merges in", "case_900", "cust_099", 2, 39},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			merged := MergeTechIssue(&card, "tech_9999", tt.caseID, tt.customerID, v, affected, now.Add(time.Hour))
			if merged.ID != card.ID || !merged.CreatedAt.Equal(card.CreatedAt) {
				t.Errorf("merge must keep the card identity: %s %v", merged.ID, merged.CreatedAt)
			}
			if len(merged.CaseIDs) != tt.wantCases || len(merged.AffectedCustomerIDs) != tt.wantAffected {
				t.Errorf("cases %v affected %d", merged.CaseIDs, len(merged.AffectedCustomerIDs))
			}
		})
	}
}

func TestComputeMetrics(t *testing.T) {
	verdicts := []Verdict{
		{Outcome: OutcomeSupportCanFix, StepsUsed: 4},
		{Outcome: OutcomeTechTeam, StepsUsed: 6},
		{Outcome: OutcomeNeedMoreInfo, Downgraded: true, StepsUsed: 3},
	}
	tests := []struct {
		name         string
		verdicts     []Verdict
		wantInv      int
		wantKept     int
		wantDown     int
		wantAvgSteps float64
	}{
		{"none", nil, 0, 0, 0, 0},
		{"mixed", verdicts, 3, 2, 1, 4.3},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := ComputeMetrics(7, tt.verdicts, ActionCounts{Executed: 1, Blocked: 2}, nil)
			if m.Investigated != tt.wantInv || m.KeptFromTech != tt.wantKept || m.Downgraded != tt.wantDown || m.AvgSteps != tt.wantAvgSteps {
				t.Errorf("got %+v", m)
			}
			if len(m.ByOutcome) != len(Outcomes) {
				t.Errorf("byOutcome must have every key: %v", m.ByOutcome)
			}
		})
	}
}

func TestActionRequestCheck(t *testing.T) {
	tests := []struct {
		name string
		req  ActionRequest
		ok   bool
	}{
		{"restore", ActionRequest{Kind: KindSupportAction, Action: &SupportAction{Type: ActionRestoreAccess, EntitlementID: "ent_0003", Reason: "grant failed"}}, true},
		{"send to tech", ActionRequest{Kind: KindSendToTech}, true},
		{"resolve", ActionRequest{Kind: KindMarkResolved}, true},
		{"support action without action", ActionRequest{Kind: KindSupportAction}, false},
		{"unknown kind", ActionRequest{Kind: "delete_customer"}, false},
		{"bad target id", ActionRequest{Kind: KindSupportAction, Action: &SupportAction{Type: ActionRefundPayment, PaymentID: "../x", Reason: "dup"}}, false},
		{"missing reason", ActionRequest{Kind: KindSupportAction, Action: &SupportAction{Type: ActionRefundPayment, PaymentID: "pay_0006"}}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.req.Check(); (err == nil) != tt.ok {
				t.Errorf("Check() = %v, want ok=%v", err, tt.ok)
			}
		})
	}
}
