package entity

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// Fix-it rules and types (docs/api.md → Fix-it, contract v2).
const (
	RuleCancel      = "C1" // cancel only an active subscription of this customer
	RuleMagicLink   = "E1" // login link only after a reset request in the last 24h, max 1 per 24h
	RuleFixEligible = "F1" // Fix-it only for a non-downgraded user_can_fix / support_can_fix verdict

	MagicLinkTemplate = "magic_link"
	magicLinkWindow   = 24 * time.Hour
	MaxFixSteps       = 6 // auto + manual steps in one plan
)

func evaluateCancel(a SupportAction, recs CustomerRecords) GateResult {
	for _, s := range recs.Subscriptions {
		if s.ID != a.SubscriptionID {
			continue
		}
		if s.Status != SubscriptionActive {
			return GateResult{false, RuleCancel, fmt.Sprintf("Subscription %s is already %s.", s.ID, s.Status)}
		}
		via := "web billing"
		if s.Channel == ChannelAppStore {
			via = "the simulated App Store connector"
		}
		return GateResult{true, RuleCancel, fmt.Sprintf("Active subscription of this customer; cancel via %s.", via)}
	}
	return GateResult{false, RuleOwnRecords, fmt.Sprintf("Subscription %s does not belong to this customer.", a.SubscriptionID)}
}

func evaluateMagicLink(recs CustomerRecords) GateResult {
	since := recs.Now.Add(-magicLinkWindow)
	requested := false
	for _, e := range recs.Events {
		if e.Type == "password_reset_requested" && !e.At.Before(since) && !e.At.After(recs.Now) {
			requested = true
		}
	}
	if !requested {
		return GateResult{false, RuleMagicLink, "No password reset request in the last 24h."}
	}
	for _, m := range recs.Emails {
		if m.Template == MagicLinkTemplate && !m.At.Before(since) {
			return GateResult{false, RuleMagicLink, fmt.Sprintf("A login link was already sent (%s); max 1 per 24h.", m.ID)}
		}
	}
	return GateResult{true, RuleMagicLink, "Reset requested in the last 24h and no login link sent yet."}
}

// CheckFixEligible decides whether Fix-it may start for a case (S1 first, then F1).
func CheckFixEligible(v *Verdict) GateResult {
	if v == nil {
		return GateResult{false, RuleFixEligible, "Investigate the case before Fix-it."}
	}
	if v.Outcome == OutcomeSuspicious {
		return GateResult{false, RuleSuspicious, "Case is flagged as suspicious; no actions allowed."}
	}
	if v.Downgraded {
		return GateResult{false, RuleFixEligible, "The verdict was downgraded; a human must review it first."}
	}
	if v.Outcome != OutcomeUserCanFix && v.Outcome != OutcomeSupportCanFix {
		return GateResult{false, RuleFixEligible, fmt.Sprintf("Fix-it only runs on user_can_fix or support_can_fix (verdict is %s).", v.Outcome)}
	}
	return GateResult{true, RuleFixEligible, "Fixable verdict."}
}

type FixStepKind string

const (
	FixAuto   FixStepKind = "auto"
	FixManual FixStepKind = "manual"
)

// FixOwner is who carries out a step: the agent (auto) or a human (manual).
type FixOwner string

const (
	OwnerAgent    FixOwner = "agent"
	OwnerSupport  FixOwner = "support"
	OwnerCustomer FixOwner = "customer"
	OwnerTech     FixOwner = "tech"
)

// FixActor is on whose behalf an auto step acts.
type FixActor string

const (
	ActorOnBehalfOfCustomer FixActor = "customer"
	ActorOnBehalfOfSupport  FixActor = "support"
)

// FixStep is one entry of a plan. Auto steps carry the tool, its input and the gate dry run.
type FixStep struct {
	ID             string         `json:"id"`
	Kind           FixStepKind    `json:"kind"`
	Owner          FixOwner       `json:"owner"`
	Title          string         `json:"title"`
	Detail         string         `json:"detail"`
	Tool           string         `json:"tool,omitempty"`
	Actor          FixActor       `json:"actor,omitempty"`
	Input          map[string]any `json:"input,omitempty"`
	Rule           string         `json:"rule,omitempty"`
	WouldBe        string         `json:"wouldBe,omitempty"` // executed | blocked
	PreviewMessage string         `json:"previewMessage,omitempty"`
	Action         *SupportAction `json:"-"` // what approve runs through ExecuteAction
}

type FixPlanStatus string

const (
	PlanDraft    FixPlanStatus = "draft"    // the agent is still adding steps
	PlanProposed FixPlanStatus = "proposed" // submitFixPlan accepted; waiting for the human click
	PlanApproved FixPlanStatus = "approved" // being executed
	PlanDone     FixPlanStatus = "done"
)

type FixPlan struct {
	ID        string        `json:"id"`
	CaseID    string        `json:"caseId"`
	Problem   string        `json:"problem"`
	Summary   string        `json:"summary"`
	Steps     []FixStep     `json:"steps"`
	ReplyBody string        `json:"replyBody"`
	CreatedAt time.Time     `json:"createdAt"`
	Status    FixPlanStatus `json:"-"`
}

// ManualSteps counts steps a human still has to do.
func (p FixPlan) ManualSteps() int {
	n := 0
	for _, s := range p.Steps {
		if s.Kind == FixManual {
			n++
		}
	}
	return n
}

// CheckSelection validates the support member's approve selection: auto steps of this plan, no repeats.
func (p FixPlan) CheckSelection(stepIDs []string) (map[string]bool, error) {
	selected := map[string]bool{}
	for _, id := range stepIDs {
		i := slices.IndexFunc(p.Steps, func(s FixStep) bool { return s.ID == id })
		switch {
		case i < 0:
			return nil, Fail(ErrBadRequest, "Step %q is not in plan %s.", id, p.ID)
		case p.Steps[i].Kind != FixAuto:
			return nil, Fail(ErrBadRequest, "Step %s is a manual step; it cannot be executed.", id)
		case selected[id]:
			return nil, Fail(ErrBadRequest, "Step %s is selected twice.", id)
		}
		selected[id] = true
	}
	return selected, nil
}

type FixStepRun struct {
	StepID string        `json:"stepId"`
	Status string        `json:"status"` // executed | blocked | skipped
	Result *ActionResult `json:"result"`
}

type FixRunResult struct {
	PlanID   string       `json:"planId"`
	Status   string       `json:"status"` // executed | stopped
	Steps    []FixStepRun `json:"steps"`
	Replied  bool         `json:"replied"`
	Resolved bool         `json:"resolved"`
}

// FixCapability is one entry of the Fix-it catalog (GET /api/fix/capabilities, MCP tool list).
type FixCapability struct {
	Tool        string   `json:"tool"`
	Actor       FixActor `json:"actor"`
	Label       string   `json:"label"`
	Description string   `json:"description"`
	Rule        string   `json:"rule"`
}

// FixPlanDraft is what the model submits through submitFixPlan.
type FixPlanDraft struct {
	Problem   string `json:"problem"`
	Summary   string `json:"summary"`
	ReplyBody string `json:"replyBody"`
}

// ManualStepDraft is the input of noteManualStep.
type ManualStepDraft struct {
	Owner  FixOwner `json:"owner"`
	Title  string   `json:"title"`
	Detail string   `json:"detail"`
}

func lengthErr(field, v string, lo, hi int) error {
	if n := utf8.RuneCountInString(strings.TrimSpace(v)); n < lo || n > hi {
		return fmt.Errorf("%s must be %d-%d characters", field, lo, hi)
	}
	return nil
}

// Check validates a submitFixPlan input; the error goes back to the model.
func (d FixPlanDraft) Check() error {
	return errors.Join(
		lengthErr("problem", d.Problem, 10, 500),
		lengthErr("summary", d.Summary, 3, 300),
		lengthErr("replyBody", d.ReplyBody, 10, MaxReplyChars),
	)
}

// Check validates a noteManualStep input.
func (d ManualStepDraft) Check() error {
	var ownerErr error
	if d.Owner != OwnerSupport && d.Owner != OwnerCustomer && d.Owner != OwnerTech {
		ownerErr = errors.New("owner must be support, customer or tech")
	}
	return errors.Join(ownerErr, lengthErr("title", d.Title, 3, 120), lengthErr("detail", d.Detail, 3, 500))
}
