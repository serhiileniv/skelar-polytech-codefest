package entity

import (
	"slices"
	"time"
)

// MergeTechIssue adds a case's tech_team verdict to the board (port of board.ts).
// Same signature → same open card; affected customers come from the deterministic detector, not the model.
// existing is the open card for the signature, or nil to create one with newID.
func MergeTechIssue(existing *TechIssue, newID string, caseID, customerID string, v Verdict, affected []string, now time.Time) TechIssue {
	var card TechIssue
	if existing != nil {
		card = *existing
	} else {
		card = TechIssue{
			ID: newID, Signature: v.TechIssue.Signature, Title: v.TechIssue.Title, RootCause: v.TechIssue.RootCause,
			EvidenceIDs: []string{}, Evidence: []Evidence{}, MessageIDs: []string{}, CaseIDs: []string{}, AffectedCustomerIDs: []string{},
			Status: TechIssueNew, CreatedAt: now.UTC(),
		}
	}
	evidence := make([]string, 0, len(v.Evidence))
	for _, e := range v.Evidence {
		evidence = append(evidence, e.ID)
	}
	card.CaseIDs = union(card.CaseIDs, []string{caseID})
	card.EvidenceIDs = union(card.EvidenceIDs, evidence)
	card.Evidence = unionEvidence(card.Evidence, v.Evidence)
	if card.MessageIDs == nil {
		card.MessageIDs = []string{}
	}
	card.AffectedCustomerIDs = union(card.AffectedCustomerIDs, append([]string{customerID}, affected...))
	return card
}

// union keeps a's order and appends unseen items of b.
func union(a, b []string) []string {
	out := slices.Clone(a)
	if out == nil {
		out = []string{}
	}
	for _, x := range b {
		if !slices.Contains(out, x) {
			out = append(out, x)
		}
	}
	return out
}
