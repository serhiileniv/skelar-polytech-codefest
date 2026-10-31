package entity

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// IDPattern is the shape of every record id (docs/api.md → Conventions).
var IDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func (o Outcome) Valid() bool { return slices.Contains(Outcomes, o) }

// VerdictDraft is what the model submits through the final submitVerdict tool.
type VerdictDraft struct {
	Outcome            Outcome        `json:"outcome"`
	Confidence         float64        `json:"confidence"`
	CustomerGoal       string         `json:"customerGoal"`
	Summary            string         `json:"summary"`
	Evidence           []Evidence     `json:"evidence"`
	InstructionSteps   []string       `json:"instructionSteps,omitempty"`
	HelpArticleID      string         `json:"helpArticleId,omitempty"`
	SupportAction      *SupportAction `json:"supportAction,omitempty"`
	TechIssue          *TechIssueRef  `json:"techIssue,omitempty"`
	ClarifyingQuestion string         `json:"clarifyingQuestion,omitempty"`
	ReplyDraft         string         `json:"replyDraft"`
}

// ParseVerdictDraft decodes and shape-checks a submitVerdict input (port of verdictSchema in schema.ts).
// The error text is sent back to the model as a tool error so it can correct itself.
func ParseVerdictDraft(raw []byte) (VerdictDraft, error) {
	var d VerdictDraft
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&d); err != nil {
		return d, fmt.Errorf("invalid verdict JSON: %v", err)
	}
	var errs []string
	bad := func(format string, args ...any) { errs = append(errs, fmt.Sprintf(format, args...)) }
	length := func(field, v string, lo, hi int) {
		if n := utf8.RuneCountInString(strings.TrimSpace(v)); n < lo || n > hi {
			bad("%s must be %d-%d characters", field, lo, hi)
		}
	}
	optLength := func(field, v string, lo, hi int) {
		if v != "" {
			length(field, v, lo, hi)
		}
	}
	id := func(field, v string) {
		if !IDPattern.MatchString(v) {
			bad("%s %q is not a valid id", field, v)
		}
	}

	if !d.Outcome.Valid() {
		bad("outcome must be one of %v", Outcomes)
	}
	if d.Confidence < 0 || d.Confidence > 1 {
		bad("confidence must be between 0 and 1")
	}
	length("customerGoal", d.CustomerGoal, 3, 300)
	length("summary", d.Summary, 3, 800)
	length("replyDraft", d.ReplyDraft, 10, 1500)
	if len(d.Evidence) > 12 {
		bad("evidence has at most 12 items")
	}
	for i, e := range d.Evidence {
		id(fmt.Sprintf("evidence[%d].id", i), e.ID)
		length(fmt.Sprintf("evidence[%d].note", i), e.Note, 3, 200)
	}
	if len(d.InstructionSteps) > 10 {
		bad("instructionSteps has at most 10 items")
	}
	for i, s := range d.InstructionSteps {
		length(fmt.Sprintf("instructionSteps[%d]", i), s, 3, 200)
	}
	if d.HelpArticleID != "" {
		id("helpArticleId", d.HelpArticleID)
	}
	if a := d.SupportAction; a != nil {
		if err := a.Check(); err != nil {
			bad("supportAction: %v", err)
		}
	}
	if t := d.TechIssue; t != nil {
		if !t.Signature.Valid() {
			bad("techIssue.signature must be one of %v", Signatures)
		}
		length("techIssue.title", t.Title, 5, 120)
		length("techIssue.rootCause", t.RootCause, 5, 500)
	}
	optLength("clarifyingQuestion", d.ClarifyingQuestion, 5, 300)
	if len(errs) > 0 {
		return d, errors.New(strings.Join(errs, "; "))
	}
	if d.Evidence == nil {
		d.Evidence = []Evidence{}
	}
	return d, nil
}

// Check validates the shape of a support action (also used for ActionRequest bodies).
func (a SupportAction) Check() error {
	var target string
	switch a.Type {
	case ActionRestoreAccess:
		target = a.EntitlementID
		if a.PaymentID != "" || a.SubscriptionID != "" {
			return errors.New("restore_access takes entitlementId only")
		}
	case ActionRefundPayment:
		target = a.PaymentID
		if a.EntitlementID != "" || a.SubscriptionID != "" {
			return errors.New("refund_payment takes paymentId only")
		}
	case ActionCancelSubscription:
		target = a.SubscriptionID
		if a.EntitlementID != "" || a.PaymentID != "" {
			return errors.New("cancel_subscription takes subscriptionId only")
		}
	case ActionSendMagicLink:
		if a.EntitlementID != "" || a.PaymentID != "" || a.SubscriptionID != "" {
			return errors.New("send_magic_link takes no target id")
		}
		target = "customer" // the case's own customer; nothing to select
	default:
		return fmt.Errorf("unknown action type %q", a.Type)
	}
	if !IDPattern.MatchString(target) {
		return fmt.Errorf("target id %q is not a valid id", target)
	}
	if n := utf8.RuneCountInString(strings.TrimSpace(a.Reason)); n < 3 || n > 300 {
		return errors.New("reason must be 3-300 characters")
	}
	return nil
}

// Target is the record id the action changes.
func (a SupportAction) Target() string {
	switch a.Type {
	case ActionRestoreAccess:
		return a.EntitlementID
	case ActionCancelSubscription:
		return a.SubscriptionID
	case ActionSendMagicLink:
		return ""
	}
	return a.PaymentID
}

// ValidationContext is what the validator checks the draft against. All sets are scoped to the case's customer.
type ValidationContext struct {
	SeenIDs        map[string]bool // every record id a tool returned during this run
	EntitlementIDs map[string]bool // the customer's entitlements
	PaymentIDs     map[string]bool // the customer's payments
	ErrorIDs       map[string]bool // the customer's error logs
	StepsUsed      int
	Now            time.Time
}

// DefaultClarifyingQuestion is used when a downgraded verdict has no question of its own.
const DefaultClarifyingQuestion = "Could you share more details so we can check this properly?"

// ValidateVerdict decides whether to trust the model's draft (port of validate.ts).
// Any inconsistency downgrades to need_more_info so a human looks before acting.
func ValidateVerdict(d VerdictDraft, ctx ValidationContext) Verdict {
	notes := []string{}
	var unseen []string
	cited := map[string]bool{}
	for _, e := range d.Evidence {
		cited[e.ID] = true
		if !ctx.SeenIDs[e.ID] {
			unseen = append(unseen, e.ID)
		}
	}
	if len(unseen) > 0 {
		notes = append(notes, "Evidence not returned by any tool: "+strings.Join(unseen, ", "))
	}
	if d.HelpArticleID != "" && !ctx.SeenIDs[d.HelpArticleID] {
		notes = append(notes, fmt.Sprintf("Help article %s was never returned by searchHelp", d.HelpArticleID))
	}

	switch d.Outcome {
	case OutcomeUserCanFix:
		if len(d.InstructionSteps) == 0 {
			notes = append(notes, "user_can_fix needs instruction steps")
		}
		if len(d.Evidence) == 0 {
			notes = append(notes, "user_can_fix needs evidence")
		}
	case OutcomeSupportCanFix:
		a := d.SupportAction
		if a == nil {
			notes = append(notes, "support_can_fix needs a support action")
			break
		}
		target := a.Target()
		owned := ctx.PaymentIDs[target]
		if a.Type == ActionRestoreAccess {
			owned = ctx.EntitlementIDs[target]
		}
		if !owned {
			notes = append(notes, fmt.Sprintf("Action target %s does not belong to this customer", target))
		}
		if !ctx.SeenIDs[target] {
			notes = append(notes, fmt.Sprintf("Action target %s was never inspected", target))
		}
	case OutcomeTechTeam:
		if d.TechIssue == nil {
			notes = append(notes, "tech_team needs a tech issue")
		}
		hasRecord := false
		for id := range cited {
			if ctx.ErrorIDs[id] || ctx.PaymentIDs[id] {
				hasRecord = true
				break
			}
		}
		if !hasRecord {
			notes = append(notes, "tech_team needs an error log or payment as evidence")
		}
	case OutcomeNeedMoreInfo:
		if d.ClarifyingQuestion == "" {
			notes = append(notes, "need_more_info needs a clarifying question")
		}
	case OutcomeSuspicious:
	}

	downgraded := len(notes) > 0 && d.Outcome != OutcomeNeedMoreInfo && d.Outcome != OutcomeSuspicious
	v := Verdict{
		Outcome:            d.Outcome,
		ModelOutcome:       d.Outcome,
		Downgraded:         downgraded,
		ValidationNotes:    notes,
		Confidence:         d.Confidence,
		CustomerGoal:       d.CustomerGoal,
		Summary:            d.Summary,
		Evidence:           d.Evidence,
		InstructionSteps:   d.InstructionSteps,
		HelpArticleID:      d.HelpArticleID,
		TechIssue:          d.TechIssue,
		ClarifyingQuestion: d.ClarifyingQuestion,
		ReplyDraft:         d.ReplyDraft,
		StepsUsed:          ctx.StepsUsed,
		CreatedAt:          ctx.Now.UTC(),
	}
	if v.Evidence == nil {
		v.Evidence = []Evidence{}
	}
	// An executable action survives only on a trusted support_can_fix verdict (never on suspicious).
	if d.Outcome == OutcomeSupportCanFix && !downgraded {
		v.SupportAction = d.SupportAction
	}
	if downgraded {
		v.Outcome = OutcomeNeedMoreInfo
		v.TechIssue = nil
		if v.ClarifyingQuestion == "" {
			v.ClarifyingQuestion = DefaultClarifyingQuestion
		}
	}
	return v
}

// NoVerdict is stored when the agent ran out of steps without a valid submitVerdict.
func NoVerdict(stepsUsed int, now time.Time, reason string) Verdict {
	return Verdict{
		Outcome:            OutcomeNeedMoreInfo,
		ModelOutcome:       OutcomeNeedMoreInfo,
		Downgraded:         true,
		ValidationNotes:    []string{reason},
		CustomerGoal:       "Unclear",
		Summary:            "The investigation did not produce a valid verdict. A support member should review the case.",
		Evidence:           []Evidence{},
		ClarifyingQuestion: DefaultClarifyingQuestion,
		ReplyDraft:         "Thanks for reaching out! " + DefaultClarifyingQuestion,
		StepsUsed:          stepsUsed,
		CreatedAt:          now.UTC(),
	}
}
