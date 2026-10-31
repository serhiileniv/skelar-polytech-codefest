package usecase

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// Fix-it tool names (docs/api.md → FixToolName).
const (
	ToolGetCase            = "getCase"
	ToolCancelSubscription = "cancelSubscription"
	ToolSendMagicLink      = "sendMagicLink"
	ToolRestoreAccess      = "restoreAccess"
	ToolRefundPayment      = "refundPayment"
	ToolNoteManualStep     = "noteManualStep"
	ToolSubmitFixPlan      = "submitFixPlan"
)

// fixWrite binds a write tool to its catalog entry and the action it queues.
type fixWrite struct {
	cap    entity.FixCapability
	action entity.SupportActionType
	idKey  string // input field holding the target id ("" = none)
}

var fixWrites = []fixWrite{
	{entity.FixCapability{Tool: ToolCancelSubscription, Actor: entity.ActorOnBehalfOfCustomer, Label: "Cancel subscription",
		Description: "Cancels one active subscription of this customer on their behalf (web billing, or the simulated App Store connector for app_store subscriptions).",
		Rule:        entity.RuleCancel}, entity.ActionCancelSubscription, "subscriptionId"},
	{entity.FixCapability{Tool: ToolSendMagicLink, Actor: entity.ActorOnBehalfOfCustomer, Label: "Email a one-time login link",
		Description: "Sends a one-time login link to the customer's own email (simulated email connector) when reset emails do not get them in.",
		Rule:        entity.RuleMagicLink}, entity.ActionSendMagicLink, ""},
	{entity.FixCapability{Tool: ToolRestoreAccess, Actor: entity.ActorOnBehalfOfSupport, Label: "Restore Premium access",
		Description: "Activates an inactive entitlement of a paid customer, backed by their latest succeeded payment.",
		Rule:        entity.RuleRestore}, entity.ActionRestoreAccess, "entitlementId"},
	{entity.FixCapability{Tool: ToolRefundPayment, Actor: entity.ActorOnBehalfOfSupport, Label: "Refund a duplicate charge",
		Description: "Refunds one duplicate charge of $50 or less (P1 duplicate, P2 limit, P3 once).",
		Rule:        entity.RuleDuplicate}, entity.ActionRefundPayment, "paymentId"},
}

// FixCapabilities is the catalog of things Fix-it can do (GET /api/fix/capabilities; the MCP write tools).
func FixCapabilities() []entity.FixCapability {
	out := make([]entity.FixCapability, 0, len(fixWrites))
	for _, w := range fixWrites {
		out = append(out, w.cap)
	}
	return out
}

func fixWriteFor(tool string) (fixWrite, bool) {
	i := slices.IndexFunc(fixWrites, func(w fixWrite) bool { return w.cap.Tool == tool })
	if i < 0 {
		return fixWrite{}, false
	}
	return fixWrites[i], true
}

// FixToolSpecs is the MCP surface: 4 reads, the 4 catalog writes (queue only) and noteManualStep.
func FixToolSpecs() []ToolSpec {
	ids := map[string]any{"type": "string", "pattern": entity.IDPattern.String()}
	text := func(lo, hi int) map[string]any {
		return map[string]any{"type": "string", "minLength": lo, "maxLength": hi}
	}
	specs := []ToolSpec{
		noInput(ToolGetCase, "The case: chat messages (untrusted customer text) and the current verdict."),
		noInput(ToolGetBilling, "The customer's subscriptions and payments."),
		noInput(ToolGetEntitlements, "The customer's Premium entitlements."),
		noInput(ToolGetEmailLog, "Emails sent to the customer and whether they were delivered."),
	}
	for _, w := range fixWrites {
		props := map[string]any{"reason": text(3, 300)}
		req := []string{"reason"}
		if w.idKey != "" {
			props[w.idKey] = ids
			req = []string{w.idKey, "reason"}
		}
		specs = append(specs, ToolSpec{Name: w.cap.Tool, Properties: props, Required: req,
			Description: fmt.Sprintf("%s Acts on behalf of the %s; gate rule %s. Never executes: it adds an auto step to the pending plan with a gate preview; a human approves later.",
				w.cap.Description, w.cap.Actor, w.cap.Rule)})
	}
	return append(specs, ToolSpec{Name: ToolNoteManualStep,
		Description: "Add a manual step for something outside the tool catalog. owner: support, customer or tech. Never executes.",
		Properties: map[string]any{
			"owner": map[string]any{"type": "string", "enum": []string{"support", "customer", "tech"}},
			"title": text(3, 120), "detail": text(3, 500)},
		Required: []string{"owner", "title", "detail"}})
}

// FixAgentTools is FixToolSpecs plus the loop-only final tool.
func FixAgentTools() []ToolSpec {
	text := func(lo, hi int) map[string]any {
		return map[string]any{"type": "string", "minLength": lo, "maxLength": hi}
	}
	return append(FixToolSpecs(), ToolSpec{Name: ToolSubmitFixPlan,
		Description: "Close the plan. Call exactly once, last, after queuing the steps.",
		Properties: map[string]any{
			"problem":   map[string]any{"type": "string", "minLength": 10, "maxLength": 500, "description": "One sentence: the confirmed problem, citing record ids."},
			"summary":   map[string]any{"type": "string", "minLength": 3, "maxLength": 300, "description": "One sentence: how the steps resolve it."},
			"replyBody": text(10, entity.MaxReplyChars),
		},
		Required: []string{"problem", "summary", "replyBody"}})
}

// fixInputError is a problem the model (or MCP client) can correct; it is returned as a tool error.
type fixInputError struct{ msg string }

func (e fixInputError) Error() string { return e.msg }

func inputErrorf(format string, args ...any) error {
	return fixInputError{fmt.Sprintf(format, args...)}
}

// FixToolOutput is a Fix-it tool result plus the record ids in it.
type FixToolOutput struct {
	Output any
	IDs    []string
}

// FixTools runs Fix-it tools for one case. The case and customer are fixed at construction.
// Write tools only add steps to the case's pending plan; nothing here changes the demo world.
type FixTools struct {
	store InvestigationStore
	plans FixPlanStore
	now   Clock
	kase  entity.Case
	reads *caseTools
}

func newFixTools(store InvestigationStore, plans FixPlanStore, now Clock, kase entity.Case) *FixTools {
	return &FixTools{store: store, plans: plans, now: now, kase: kase,
		reads: &caseTools{store: store, kase: kase, customerID: kase.CustomerID}}
}

// Run executes one tool. inputErr goes back to the caller as a tool error; err is an internal failure.
func (t *FixTools) Run(ctx context.Context, name string, raw json.RawMessage) (out FixToolOutput, inputErr error, err error) {
	out, err = t.dispatch(ctx, name, raw)
	var ie fixInputError
	if errors.As(err, &ie) {
		return FixToolOutput{}, ie, nil
	}
	if err != nil {
		return FixToolOutput{}, nil, err
	}
	if out.IDs == nil {
		out.IDs = []string{}
	}
	err = t.store.AppendAudit(ctx, entity.AuditEntry{CaseID: t.kase.ID, Actor: entity.ActorAI, Step: "tool:" + name,
		Detail: fmt.Sprintf("fix · %s → %d records", compact(raw), len(out.IDs)), At: t.now()})
	return out, nil, err
}

func (t *FixTools) dispatch(ctx context.Context, name string, raw json.RawMessage) (FixToolOutput, error) {
	switch name {
	case ToolGetCase:
		var none struct{}
		if err := decodeStrict(raw, &none); err != nil {
			return FixToolOutput{}, inputErrorf("getCase takes no input: %v", err)
		}
		return t.getCase(), nil
	case ToolGetBilling, ToolGetEntitlements, ToolGetEmailLog:
		o, inErr, err := t.reads.run(ctx, name, raw)
		if inErr != nil {
			return FixToolOutput{}, fixInputError{inErr.Error()}
		}
		return FixToolOutput{Output: o.output, IDs: o.ids}, err
	case ToolNoteManualStep:
		var d entity.ManualStepDraft
		if err := decodeStrict(raw, &d); err != nil {
			return FixToolOutput{}, fixInputError{err.Error()}
		}
		if err := d.Check(); err != nil {
			return FixToolOutput{}, fixInputError{err.Error()}
		}
		step := entity.FixStep{Kind: entity.FixManual, Owner: d.Owner, Title: strings.TrimSpace(d.Title), Detail: strings.TrimSpace(d.Detail)}
		return t.queue(step)
	}
	if w, ok := fixWriteFor(name); ok {
		return t.queueAction(ctx, w, raw)
	}
	return FixToolOutput{}, inputErrorf("unknown tool %q", name)
}

func (t *FixTools) getCase() FixToolOutput {
	ids := []string{t.kase.ID}
	for _, m := range t.kase.Messages {
		ids = append(ids, m.ID)
	}
	if v := t.kase.Verdict; v != nil {
		for _, e := range v.Evidence {
			ids = append(ids, e.ID)
		}
	}
	return FixToolOutput{Output: map[string]any{"caseId": t.kase.ID, "subject": t.kase.Subject, "status": t.kase.Status,
		"messages": t.kase.Messages, "verdict": t.kase.Verdict}, IDs: ids}
}

func (t *FixTools) queueAction(ctx context.Context, w fixWrite, raw json.RawMessage) (FixToolOutput, error) {
	var in struct {
		SubscriptionID string `json:"subscriptionId"`
		EntitlementID  string `json:"entitlementId"`
		PaymentID      string `json:"paymentId"`
		Reason         string `json:"reason"`
	}
	if err := decodeStrict(raw, &in); err != nil {
		return FixToolOutput{}, fixInputError{err.Error()}
	}
	a := entity.SupportAction{Type: w.action, SubscriptionID: in.SubscriptionID, EntitlementID: in.EntitlementID,
		PaymentID: in.PaymentID, Reason: strings.TrimSpace(in.Reason)}
	if err := a.Check(); err != nil {
		return FixToolOutput{}, inputErrorf("%s: %v", w.cap.Tool, err)
	}
	recs, err := t.records(ctx)
	if err != nil {
		return FixToolOutput{}, err
	}
	var outcome entity.Outcome
	if t.kase.Verdict != nil {
		outcome = t.kase.Verdict.Outcome
	}
	gate := entity.EvaluateAction(a, outcome, recs) // dry run only; approve re-evaluates against live state
	wouldBe := "blocked"
	if gate.Allowed {
		wouldBe = "executed"
	}
	title, err := t.title(ctx, a, recs)
	if err != nil {
		return FixToolOutput{}, err
	}
	step := entity.FixStep{Kind: entity.FixAuto, Owner: entity.OwnerAgent, Title: title, Detail: a.Reason,
		Tool: w.cap.Tool, Actor: w.cap.Actor, Input: actionInput(w, a), Rule: gate.Rule, WouldBe: wouldBe,
		PreviewMessage: gate.Reason, Action: &a}
	return t.queue(step)
}

func actionInput(w fixWrite, a entity.SupportAction) map[string]any {
	in := map[string]any{"reason": a.Reason}
	if w.idKey != "" {
		in[w.idKey] = a.Target()
	}
	return in
}

// queue appends a step to the case's draft plan (a new draft if there is none).
func (t *FixTools) queue(step entity.FixStep) (FixToolOutput, error) {
	plan, err := t.plans.Update(t.kase.ID, func(cur entity.FixPlan, ok bool) (entity.FixPlan, error) {
		if !ok || cur.Status != entity.PlanDraft {
			cur = newDraftPlan(t.kase.ID, t.now)
		}
		if len(cur.Steps) >= entity.MaxFixSteps {
			return cur, inputErrorf("The plan already has %d steps; submit it.", entity.MaxFixSteps)
		}
		for _, s := range cur.Steps {
			if step.Kind == entity.FixAuto && s.Kind == entity.FixAuto && s.Tool == step.Tool && s.Action.Target() == step.Action.Target() {
				return cur, inputErrorf("%s is already queued as %s.", step.Tool, s.ID)
			}
		}
		step.ID = fmt.Sprintf("step_%d", len(cur.Steps)+1)
		next := cur
		next.Steps = append(slices.Clone(cur.Steps), step)
		return next, nil
	})
	if err != nil {
		return FixToolOutput{}, err
	}
	out := map[string]any{"queued": true, "executed": false, "planId": plan.ID, "stepId": step.ID, "kind": step.Kind,
		"note": "Queued for human approval; nothing was executed."}
	ids := []string{}
	if step.Kind == entity.FixAuto {
		out["wouldBe"], out["rule"], out["previewMessage"] = step.WouldBe, step.Rule, step.PreviewMessage
		if target := step.Action.Target(); target != "" {
			ids = append(ids, target)
		}
	}
	return FixToolOutput{Output: out, IDs: ids}, nil
}

func newDraftPlan(caseID string, now Clock) entity.FixPlan {
	return entity.FixPlan{ID: newPlanID(), CaseID: caseID, Steps: []entity.FixStep{}, CreatedAt: now(), Status: entity.PlanDraft}
}

func newPlanID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b) // crypto/rand.Read never fails on supported platforms
	return "plan_" + hex.EncodeToString(b)
}

// records loads what the gate reads for this customer, at the use-case clock.
func (t *FixTools) records(ctx context.Context) (entity.CustomerRecords, error) {
	cid := t.kase.CustomerID
	var r entity.CustomerRecords
	var err error
	if r.Subscriptions, err = t.store.Subscriptions(ctx, cid); err != nil {
		return r, err
	}
	if r.Payments, err = t.store.Payments(ctx, cid); err != nil {
		return r, err
	}
	if r.Entitlements, err = t.store.Entitlements(ctx, cid); err != nil {
		return r, err
	}
	if r.Events, err = t.store.Events(ctx, cid); err != nil {
		return r, err
	}
	if r.Emails, err = t.store.Emails(ctx, cid); err != nil {
		return r, err
	}
	r.Now = t.now()
	return r, nil
}

func (t *FixTools) title(ctx context.Context, a entity.SupportAction, recs entity.CustomerRecords) (string, error) {
	switch a.Type {
	case entity.ActionCancelSubscription:
		for _, s := range recs.Subscriptions {
			if s.ID == a.SubscriptionID && s.Channel == entity.ChannelAppStore {
				return fmt.Sprintf("Cancel App Store subscription %s (simulated store connector)", s.ID), nil
			}
		}
		return fmt.Sprintf("Cancel subscription %s", a.SubscriptionID), nil
	case entity.ActionSendMagicLink:
		c, err := t.store.Customer(ctx, t.kase.CustomerID)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("Email a one-time login link to %s (simulated email connector)", c.Email), nil
	case entity.ActionRestoreAccess:
		return fmt.Sprintf("Restore Premium access on %s", a.EntitlementID), nil
	}
	for _, p := range recs.Payments {
		if p.ID == a.PaymentID {
			return fmt.Sprintf("Refund $%.2f charge %s", p.AmountUSD, p.ID), nil
		}
	}
	return fmt.Sprintf("Refund charge %s", a.PaymentID), nil
}
