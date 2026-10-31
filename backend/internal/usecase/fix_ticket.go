package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// queueTicket adds a createTechTicket auto step with a T2 dry run. Approve creates the card via ExecuteAction.
func (t *FixTools) queueTicket(ctx context.Context, raw json.RawMessage) (FixToolOutput, error) {
	var d entity.TechTicketDraft
	if err := decodeStrict(raw, &d); err != nil {
		return FixToolOutput{}, fixInputError{err.Error()}
	}
	d.Title, d.RootCause = strings.TrimSpace(d.Title), strings.TrimSpace(d.RootCause)
	recs, err := t.records(ctx)
	if err != nil {
		return FixToolOutput{}, err
	}
	if d.Signature == "" {
		d.Signature = ticketSignature(d, recs.Errors, t.kase.Verdict)
	}
	if err := d.Check(); err != nil {
		return FixToolOutput{}, inputErrorf("%s: %v", ToolCreateTechTicket, err)
	}
	open, err := openTicketForCase(ctx, t.store, t.kase.ID)
	if err != nil {
		return FixToolOutput{}, err
	}
	gate := entity.EvaluateTechTicket(d, t.kase, recs, open) // dry run; approve re-evaluates
	wouldBe := "blocked"
	if gate.Allowed {
		wouldBe = "executed"
	}
	input := map[string]any{"title": d.Title, "rootCause": d.RootCause, "signature": d.Signature, "evidence": d.Evidence}
	step := entity.FixStep{Kind: entity.FixAuto, Owner: entity.OwnerAgent, Title: "Create tech ticket: " + d.Title, Detail: d.RootCause,
		Tool: ToolCreateTechTicket, Actor: ticketCapability.Actor, Input: input, Rule: gate.Rule, WouldBe: wouldBe,
		PreviewMessage: gate.Reason, Ticket: &d}
	out, err := t.queue(step)
	out.IDs = append(out.IDs, d.EvidenceIDs()...)
	return out, err
}

// ticketSignature is the signature the first cited error log proves, else the verdict's tech issue ("" if neither).
func ticketSignature(d entity.TechTicketDraft, errs []entity.ErrorLog, v *entity.Verdict) entity.Signature {
	for _, id := range d.EvidenceIDs() {
		i := slices.IndexFunc(errs, func(e entity.ErrorLog) bool { return e.ID == id })
		if i < 0 {
			continue
		}
		if s, ok := entity.SignatureForError(errs[i].Code); ok {
			return s
		}
	}
	if v != nil && v.TechIssue != nil {
		return v.TechIssue.Signature
	}
	return ""
}

// openTicketForCase is the unresolved board card that already lists the case, or nil.
func openTicketForCase(ctx context.Context, board BoardReader, caseID string) (*entity.TechIssue, error) {
	cards, err := board.ListTechIssues(ctx)
	if err != nil {
		return nil, err
	}
	for i, c := range cards {
		if c.Status != entity.TechIssueResolved && slices.Contains(c.CaseIDs, caseID) {
			return &cards[i], nil
		}
	}
	return nil, nil
}

// ticketMessage is the ActionResult message for a created or extended card.
func ticketMessage(card entity.TechIssue, merged bool) string {
	verb := "Created"
	if merged {
		verb = "Added the case to"
	}
	return fmt.Sprintf("%s tech ticket %s %q · %d evidence · %d customers affected.", verb, card.ID, card.Title, len(card.EvidenceIDs), len(card.AffectedCustomerIDs))
}
