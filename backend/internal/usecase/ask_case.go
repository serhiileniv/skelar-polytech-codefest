package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// Answerer is one plain completion (no tools). Returns entity.ErrLLMUnavailable without a live model.
type Answerer interface {
	Answer(ctx context.Context, system, prompt string) (string, error)
}

// AskCase answers the support agent's question about a stored verdict from the case customer's records only.
type AskCase struct {
	store InvestigationStore
	model Answerer
}

func NewAskCase(store InvestigationStore, model Answerer) *AskCase {
	return &AskCase{store: store, model: model}
}

// askRecords is every record the answer may cite, all scoped to the case's customer.
type askRecords struct {
	Customer      entity.Customer       `json:"customer"`
	Subscriptions []entity.Subscription `json:"subscriptions"`
	Payments      []entity.Payment      `json:"payments"`
	Entitlements  []entity.Entitlement  `json:"entitlements"`
	Events        []entity.SessionEvent `json:"events"`
	Errors        []entity.ErrorLog     `json:"errors"`
	Emails        []entity.EmailLog     `json:"emails"`
	HelpArticle   *entity.HelpArticle   `json:"helpArticle,omitempty"` // the one the verdict cites
}

// Ask: 400 bad id/question, 404 unknown case, 409 no verdict yet. Without a live model it answers from the verdict.
func (u *AskCase) Ask(ctx context.Context, caseID, question string) (entity.Answer, error) {
	if err := checkID(caseID); err != nil {
		return entity.Answer{}, err
	}
	q, err := entity.CheckQuestion(question)
	if err != nil {
		return entity.Answer{}, err
	}
	kase, err := u.store.Case(ctx, caseID)
	if err != nil {
		return entity.Answer{}, err
	}
	if kase.Verdict == nil {
		return entity.Answer{}, entity.Fail(entity.ErrConflict, "Case %s has no verdict yet. Run Investigate first.", caseID)
	}
	recs, err := u.records(ctx, kase.CustomerID, kase.Verdict.HelpArticleID)
	if err != nil {
		return entity.Answer{}, err
	}
	prompt, err := askPrompt(kase, recs, q)
	if err != nil {
		return entity.Answer{}, err
	}
	text, err := u.model.Answer(ctx, AskSystemPrompt, prompt)
	if errors.Is(err, entity.ErrLLMUnavailable) {
		text = fallbackAnswer(*kase.Verdict)
	} else if err != nil {
		return entity.Answer{}, err
	}
	text = entity.CapAnswer(text)
	if text == "" {
		return entity.Answer{}, fmt.Errorf("ask %s: model returned an empty answer", caseID)
	}
	return entity.Answer{Answer: text, Evidence: entity.CitedIDs(text, recs.ids())}, nil
}

func (u *AskCase) records(ctx context.Context, customerID, helpID string) (askRecords, error) {
	var r askRecords
	var err error
	if r.Customer, err = u.store.Customer(ctx, customerID); err != nil {
		return r, err
	}
	if r.Subscriptions, err = u.store.Subscriptions(ctx, customerID); err != nil {
		return r, err
	}
	if r.Payments, err = u.store.Payments(ctx, customerID); err != nil {
		return r, err
	}
	if r.Entitlements, err = u.store.Entitlements(ctx, customerID); err != nil {
		return r, err
	}
	if r.Events, err = u.store.Events(ctx, customerID); err != nil {
		return r, err
	}
	if r.Errors, err = u.store.Errors(ctx, customerID); err != nil {
		return r, err
	}
	if r.Emails, err = u.store.Emails(ctx, customerID); err != nil {
		return r, err
	}
	if helpID == "" {
		return r, nil
	}
	arts, err := u.store.HelpArticles(ctx)
	if err != nil {
		return r, err
	}
	for i := range arts {
		if arts[i].ID == helpID {
			r.HelpArticle = &arts[i]
		}
	}
	return r, nil
}

// ids is the set the answer's evidence is validated against.
func (r askRecords) ids() map[string]bool {
	ids := map[string]bool{}
	for _, s := range r.Subscriptions {
		ids[s.ID] = true
	}
	for _, p := range r.Payments {
		ids[p.ID] = true
	}
	for _, e := range r.Entitlements {
		ids[e.ID] = true
	}
	for _, e := range r.Events {
		ids[e.ID] = true
	}
	for _, e := range r.Errors {
		ids[e.ID] = true
	}
	for _, e := range r.Emails {
		ids[e.ID] = true
	}
	if r.HelpArticle != nil {
		ids[r.HelpArticle.ID] = true
	}
	return ids
}

// fallbackAnswer is the no-model answer: the verdict's own summary and cited evidence.
func fallbackAnswer(v entity.Verdict) string {
	var b strings.Builder
	b.WriteString(v.Summary)
	for _, e := range v.Evidence {
		fmt.Fprintf(&b, " %s: %s.", e.ID, strings.TrimSuffix(e.Note, "."))
	}
	return b.String()
}
