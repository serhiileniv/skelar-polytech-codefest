package entity_test

import (
	"testing"
	"time"

	. "github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/seed"
)

// fullRecords is recordsOf plus what C1/E1 read, at the seed clock.
func fullRecords(w World, customerID string) CustomerRecords {
	r := recordsOf(w, customerID)
	for _, s := range w.Subscriptions {
		if s.CustomerID == customerID {
			r.Subscriptions = append(r.Subscriptions, s)
		}
	}
	for _, e := range w.Events {
		if e.CustomerID == customerID {
			r.Events = append(r.Events, e)
		}
	}
	for _, m := range w.Emails {
		if m.CustomerID == customerID {
			r.Emails = append(r.Emails, m)
		}
	}
	r.Now = seed.Now
	return r
}

func TestFixGateRules(t *testing.T) {
	w := seed.World()
	canceled := fullRecords(w, "cust_001")
	canceled.Subscriptions[0].Status = SubscriptionCanceled
	linkSent := fullRecords(w, "cust_002")
	linkSent.Emails = append(linkSent.Emails, EmailLog{ID: "mail_r0001", Template: MagicLinkTemplate, At: seed.Now.Add(-time.Minute)})
	staleLink := fullRecords(w, "cust_002")
	staleLink.Emails = append(staleLink.Emails, EmailLog{ID: "mail_r0001", Template: MagicLinkTemplate, At: seed.Now.Add(-25 * time.Hour)})
	dayLater := fullRecords(w, "cust_002")
	dayLater.Now = seed.Now.Add(26 * time.Hour)

	cancel := func(id string) SupportAction {
		return SupportAction{Type: ActionCancelSubscription, SubscriptionID: id, Reason: "app deleted"}
	}
	link := SupportAction{Type: ActionSendMagicLink, Reason: "reset mail lost"}
	tests := []struct {
		name    string
		action  SupportAction
		outcome Outcome
		recs    CustomerRecords
		allowed bool
		rule    string
	}{
		{"cancel own active App Store sub", cancel("sub_0001"), OutcomeUserCanFix, fullRecords(w, "cust_001"), true, RuleCancel},
		{"cancel already canceled sub", cancel("sub_0001"), OutcomeUserCanFix, canceled, false, RuleCancel},
		{"cancel another customer's sub", cancel("sub_0002"), OutcomeUserCanFix, fullRecords(w, "cust_001"), false, RuleOwnRecords},
		{"cancel on suspicious case", cancel("sub_0001"), OutcomeSuspicious, fullRecords(w, "cust_001"), false, RuleSuspicious},
		{"magic link after recent reset requests", link, OutcomeUserCanFix, fullRecords(w, "cust_002"), true, RuleMagicLink},
		{"magic link without reset request", link, OutcomeUserCanFix, fullRecords(w, "cust_001"), false, RuleMagicLink},
		{"second magic link within 24h", link, OutcomeUserCanFix, linkSent, false, RuleMagicLink},
		{"magic link after an old link", link, OutcomeUserCanFix, staleLink, true, RuleMagicLink},
		{"reset request older than 24h", link, OutcomeUserCanFix, dayLater, false, RuleMagicLink},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := EvaluateAction(tt.action, tt.outcome, tt.recs)
			if r.Allowed != tt.allowed || r.Rule != tt.rule || r.Reason == "" {
				t.Errorf("got allowed=%v rule=%s (%s), want allowed=%v rule=%s", r.Allowed, r.Rule, r.Reason, tt.allowed, tt.rule)
			}
		})
	}
}

func TestCheckFixEligible(t *testing.T) {
	v := func(o Outcome, downgraded bool) *Verdict { return &Verdict{Outcome: o, Downgraded: downgraded} }
	tests := []struct {
		name    string
		verdict *Verdict
		allowed bool
		rule    string
	}{
		{"not investigated", nil, false, RuleFixEligible},
		{"user_can_fix", v(OutcomeUserCanFix, false), true, RuleFixEligible},
		{"support_can_fix", v(OutcomeSupportCanFix, false), true, RuleFixEligible},
		{"downgraded support_can_fix", v(OutcomeSupportCanFix, true), false, RuleFixEligible},
		{"tech_team", v(OutcomeTechTeam, false), false, RuleFixEligible},
		{"need_more_info", v(OutcomeNeedMoreInfo, false), false, RuleFixEligible},
		{"suspicious is S1 first", v(OutcomeSuspicious, false), false, RuleSuspicious},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := CheckFixEligible(tt.verdict)
			if r.Allowed != tt.allowed || r.Rule != tt.rule {
				t.Errorf("got allowed=%v rule=%s, want allowed=%v rule=%s", r.Allowed, r.Rule, tt.allowed, tt.rule)
			}
		})
	}
}

func TestFixPlanCheckSelection(t *testing.T) {
	p := FixPlan{ID: "plan_1", Steps: []FixStep{{ID: "step_1", Kind: FixAuto}, {ID: "step_2", Kind: FixManual}, {ID: "step_3", Kind: FixAuto}}}
	tests := []struct {
		name    string
		ids     []string
		wantErr bool
	}{
		{"all auto steps", []string{"step_1", "step_3"}, false},
		{"empty selection", []string{}, false},
		{"manual step", []string{"step_2"}, true},
		{"unknown step", []string{"step_9"}, true},
		{"duplicate", []string{"step_1", "step_1"}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := p.CheckSelection(tt.ids)
			if (err != nil) != tt.wantErr {
				t.Errorf("err = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestSupportActionCheckV2(t *testing.T) {
	tests := []struct {
		name    string
		a       SupportAction
		wantErr bool
	}{
		{"cancel", SupportAction{Type: ActionCancelSubscription, SubscriptionID: "sub_0001", Reason: "app deleted"}, false},
		{"cancel without id", SupportAction{Type: ActionCancelSubscription, Reason: "app deleted"}, true},
		{"cancel with payment id", SupportAction{Type: ActionCancelSubscription, SubscriptionID: "sub_0001", PaymentID: "pay_1", Reason: "x y z"}, true},
		{"magic link", SupportAction{Type: ActionSendMagicLink, Reason: "reset lost"}, false},
		{"magic link with target", SupportAction{Type: ActionSendMagicLink, SubscriptionID: "sub_0001", Reason: "reset lost"}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.a.Check(); (err != nil) != tt.wantErr {
				t.Errorf("err = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
