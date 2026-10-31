package entity

import (
	"slices"
	"testing"
	"time"
)

func TestEvaluateTechTicket(t *testing.T) {
	kase := Case{ID: "case_105", CustomerID: "cust_005", Messages: []ChatMessage{{ID: "msg_0009"}},
		Verdict: &Verdict{Outcome: OutcomeSupportCanFix}}
	recs := CustomerRecords{Payments: []Payment{{ID: "pay_0006"}}, Errors: []ErrorLog{{ID: "err_0003", Code: "IDEMPOTENCY_KEY_MISSING"}}}
	draft := func(ids ...string) TechTicketDraft {
		d := TechTicketDraft{Title: "Duplicate renewal", RootCause: "err_0003 shows a retry without key.", Signature: SignatureDuplicateCharge}
		for _, id := range ids {
			d.Evidence = append(d.Evidence, Evidence{ID: id, Note: "cited"})
		}
		return d
	}
	noVerdict, suspicious := kase, kase
	noVerdict.Verdict = nil
	suspicious.Verdict = &Verdict{Outcome: OutcomeSuspicious}
	tests := []struct {
		name     string
		d        TechTicketDraft
		kase     Case
		open     *TechIssue
		wantOK   bool
		wantRule string
	}{
		{"error log + payment + message", draft("err_0003", "pay_0006", "msg_0009"), kase, nil, true, RuleTechTicket},
		{"no verdict", draft("err_0003"), noVerdict, nil, false, RuleTechTicket},
		{"suspicious", draft("err_0003"), suspicious, nil, false, RuleSuspicious},
		{"open ticket for the case", draft("err_0003"), kase, &TechIssue{ID: "tech_0001"}, false, RuleTechTicket},
		{"other customer's record", draft("err_0003", "pay_0001"), kase, nil, false, RuleTechTicket},
		{"no error log", draft("pay_0006"), kase, nil, false, RuleTechTicket},
		{"err-looking id not owned", draft("err_0009"), kase, nil, false, RuleTechTicket},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			g := EvaluateTechTicket(tt.d, tt.kase, recs, tt.open)
			if g.Allowed != tt.wantOK || g.Rule != tt.wantRule {
				t.Fatalf("got %+v", g)
			}
		})
	}
}

func TestTechTicketDraftCheck(t *testing.T) {
	ok := TechTicketDraft{Title: "Duplicate renewal", RootCause: "err_0003 shows a retry without key.", Signature: SignatureDuplicateCharge,
		Evidence: []Evidence{{ID: "err_0003", Note: "retry"}}}
	tests := []struct {
		name    string
		mutate  func(d TechTicketDraft) TechTicketDraft
		wantErr bool
	}{
		{"valid", func(d TechTicketDraft) TechTicketDraft { return d }, false},
		{"no evidence", func(d TechTicketDraft) TechTicketDraft { d.Evidence = nil; return d }, true},
		{"unknown signature", func(d TechTicketDraft) TechTicketDraft { d.Signature = "other"; return d }, true},
		{"empty signature", func(d TechTicketDraft) TechTicketDraft { d.Signature = ""; return d }, true},
		{"short root cause", func(d TechTicketDraft) TechTicketDraft { d.RootCause = "bug"; return d }, true},
		{"bad evidence id", func(d TechTicketDraft) TechTicketDraft { d.Evidence = []Evidence{{ID: "a b", Note: "x y z"}}; return d }, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.mutate(ok).Check(); (err != nil) != tt.wantErr {
				t.Fatalf("err = %v", err)
			}
		})
	}
}

func TestManualStepOwnerIsCustomerOnly(t *testing.T) {
	for owner, wantErr := range map[FixOwner]bool{OwnerCustomer: false, "support": true, "tech": true, OwnerAgent: true} {
		err := ManualStepDraft{Owner: owner, Title: "Confirm", Detail: "In Apple ID"}.Check()
		if (err != nil) != wantErr {
			t.Fatalf("owner %s: err = %v", owner, err)
		}
	}
}

func TestTicketCard(t *testing.T) {
	now := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)
	kase := Case{ID: "case_105", CustomerID: "cust_005", Messages: []ChatMessage{{ID: "msg_0009"}, {ID: "msg_0010"}}}
	d := TechTicketDraft{Title: "Duplicate renewal", RootCause: "err_0003 shows a retry without key.", Signature: SignatureDuplicateCharge,
		Evidence: []Evidence{{ID: "err_0003", Note: "retry"}, {ID: "pay_0006", Note: "duplicate"}}}

	created := TicketCard(nil, "tech_0002", kase, d, []string{"cust_005", "cust_009"}, now)
	if created.ID != "tech_0002" || created.Status != TechIssueNew || created.Title != d.Title || created.RootCause != d.RootCause ||
		!slices.Equal(created.EvidenceIDs, []string{"err_0003", "pay_0006"}) || len(created.Evidence) != 2 ||
		!slices.Equal(created.MessageIDs, []string{"msg_0009", "msg_0010"}) || !slices.Equal(created.CaseIDs, []string{"case_105"}) ||
		!slices.Equal(created.AffectedCustomerIDs, []string{"cust_005", "cust_009"}) {
		t.Fatalf("created %+v", created)
	}

	existing := TechIssue{ID: "tech_0001", Title: "Old title", Signature: SignatureDuplicateCharge, CaseIDs: []string{"case_200"},
		EvidenceIDs: []string{"err_0003"}, Evidence: []Evidence{{ID: "err_0003", Note: "old"}}, AffectedCustomerIDs: []string{"cust_009"}}
	merged := TicketCard(&existing, "", kase, d, nil, now)
	if merged.ID != "tech_0001" || merged.Title != "Old title" || !slices.Equal(merged.CaseIDs, []string{"case_200", "case_105"}) ||
		!slices.Equal(merged.EvidenceIDs, []string{"err_0003", "pay_0006"}) || merged.Evidence[0].Note != "old" ||
		!slices.Equal(merged.AffectedCustomerIDs, []string{"cust_009", "cust_005"}) {
		t.Fatalf("merged %+v", merged)
	}
}
