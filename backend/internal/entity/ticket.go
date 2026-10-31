package entity

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
)

// RuleTechTicket gates Fix-it's createTechTicket (docs/api.md → Fix-it, rule T2).
const (
	RuleTechTicket    = "T2"
	MaxTicketEvidence = 8 // evidence entries on one ticket
	errorLogPrefix    = "err_"
)

// errorCodeSignatures maps an error-log code to the root-cause signature it proves.
var errorCodeSignatures = map[string]Signature{
	"IDEMPOTENCY_KEY_MISSING": SignatureDuplicateCharge,
	"GRANT_FAILED":            SignatureEntitlementGrantFailed,
	"CANCEL_SYNC_TIMEOUT":     SignatureCancelNotSynced,
}

// SignatureForError is the signature an error-log code proves.
func SignatureForError(code string) (Signature, bool) {
	s, ok := errorCodeSignatures[code]
	return s, ok
}

// TechTicketDraft is a tech-board ticket Fix-it queues: the agent's evaluation plus the records it rests on.
type TechTicketDraft struct {
	Title     string     `json:"title"`
	RootCause string     `json:"rootCause"`
	Signature Signature  `json:"signature"`
	Evidence  []Evidence `json:"evidence"`
}

// Check validates the shape; T2 decides whether it may be created.
func (d TechTicketDraft) Check() error {
	errs := []error{lengthErr("title", d.Title, 5, 120), lengthErr("rootCause", d.RootCause, 10, 500)}
	if !d.Signature.Valid() {
		errs = append(errs, fmt.Errorf("signature must be one of %v", Signatures))
	}
	if n := len(d.Evidence); n < 1 || n > MaxTicketEvidence {
		errs = append(errs, fmt.Errorf("evidence must have 1-%d entries", MaxTicketEvidence))
	}
	for _, e := range d.Evidence {
		if !IDPattern.MatchString(e.ID) {
			errs = append(errs, fmt.Errorf("evidence id %q is not a valid id", e.ID))
		}
		errs = append(errs, lengthErr("evidence note", e.Note, 3, 200))
	}
	return errors.Join(errs...)
}

// EvidenceIDs lists the cited record ids in order.
func (d TechTicketDraft) EvidenceIDs() []string {
	ids := make([]string, 0, len(d.Evidence))
	for _, e := range d.Evidence {
		ids = append(ids, e.ID)
	}
	return ids
}

// OwnedIDs is every record id of the case and its customer: the case, its messages and the customer's records.
func OwnedIDs(kase Case, recs CustomerRecords) map[string]bool {
	ids := map[string]bool{kase.ID: true, kase.CustomerID: true}
	for _, m := range kase.Messages {
		ids[m.ID] = true
	}
	add := func(id string) { ids[id] = true }
	for _, x := range recs.Subscriptions {
		add(x.ID)
	}
	for _, x := range recs.Payments {
		add(x.ID)
	}
	for _, x := range recs.Entitlements {
		add(x.ID)
	}
	for _, x := range recs.Events {
		add(x.ID)
	}
	for _, x := range recs.Emails {
		add(x.ID)
	}
	for _, x := range recs.Errors {
		add(x.ID)
	}
	return ids
}

// EvaluateTechTicket is rule T2: a verdict exists, every cited id is this case's or its customer's record,
// at least one is the customer's error log, and no ticket for this case is open yet.
// openForCase is the open card that already lists this case, or nil.
func EvaluateTechTicket(d TechTicketDraft, kase Case, recs CustomerRecords, openForCase *TechIssue) GateResult {
	if kase.Verdict == nil {
		return GateResult{false, RuleTechTicket, "Investigate the case before creating a tech ticket."}
	}
	if kase.Verdict.Outcome == OutcomeSuspicious {
		return GateResult{false, RuleSuspicious, "Case is flagged as suspicious; no actions allowed."}
	}
	if openForCase != nil {
		return GateResult{false, RuleTechTicket, fmt.Sprintf("Ticket %s is already open for %s.", openForCase.ID, kase.ID)}
	}
	owned := OwnedIDs(kase, recs)
	errorLog := ""
	for _, id := range d.EvidenceIDs() {
		if !owned[id] {
			return GateResult{false, RuleTechTicket, fmt.Sprintf("Evidence %s is not a record of this case or its customer.", id)}
		}
		if errorLog == "" && strings.HasPrefix(id, errorLogPrefix) {
			errorLog = id
		}
	}
	if errorLog == "" {
		return GateResult{false, RuleTechTicket, "A tech ticket must cite at least one error log (err_*) of this customer."}
	}
	return GateResult{true, RuleTechTicket, fmt.Sprintf("Verdict exists; evidence is this customer's records, incl. %s.", errorLog)}
}

// TicketCard creates (existing == nil, with newID) or extends the open card for the draft's signature.
// Affected customers are this customer plus the deterministic detector's matches.
func TicketCard(existing *TechIssue, newID string, kase Case, d TechTicketDraft, affected []string, now time.Time) TechIssue {
	var card TechIssue
	if existing != nil {
		card = *existing
	} else {
		card = TechIssue{ID: newID, Signature: d.Signature, Title: strings.TrimSpace(d.Title), RootCause: strings.TrimSpace(d.RootCause),
			Status: TechIssueNew, CreatedAt: now.UTC()}
	}
	messages := make([]string, 0, len(kase.Messages))
	for _, m := range kase.Messages {
		messages = append(messages, m.ID)
	}
	card.CaseIDs = union(card.CaseIDs, []string{kase.ID})
	card.EvidenceIDs = union(card.EvidenceIDs, d.EvidenceIDs())
	card.Evidence = unionEvidence(card.Evidence, d.Evidence)
	card.MessageIDs = union(card.MessageIDs, messages)
	card.AffectedCustomerIDs = union(card.AffectedCustomerIDs, append([]string{kase.CustomerID}, affected...))
	return card
}

// unionEvidence keeps a's order and appends entries of b with unseen ids.
func unionEvidence(a, b []Evidence) []Evidence {
	out := slices.Clone(a)
	if out == nil {
		out = []Evidence{}
	}
	for _, e := range b {
		if !slices.ContainsFunc(out, func(x Evidence) bool { return x.ID == e.ID }) {
			out = append(out, Evidence{ID: e.ID, Note: strings.TrimSpace(e.Note)})
		}
	}
	return out
}
