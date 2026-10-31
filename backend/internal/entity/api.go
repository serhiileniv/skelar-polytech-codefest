package entity

import (
	"strings"
	"time"
	"unicode/utf8"
)

// Read models and request/response shapes from docs/api.md that are not stored entities.

type CaseListItem struct {
	ID           string     `json:"id"`
	Subject      string     `json:"subject"`
	CustomerName string     `json:"customerName"`
	Preview      string     `json:"preview"`
	Status       CaseStatus `json:"status"`
	Outcome      *Outcome   `json:"outcome"`
	CreatedAt    time.Time  `json:"createdAt"`
}

type CaseDetail struct {
	Case          Case           `json:"case"`
	Customer      Customer       `json:"customer"`
	Subscriptions []Subscription `json:"subscriptions"`
	Payments      []Payment      `json:"payments"`
	Entitlements  []Entitlement  `json:"entitlements"`
	Audit         []AuditEntry   `json:"audit"`
}

type ActionKind string

const (
	KindSupportAction ActionKind = "support_action"
	KindSendToTech    ActionKind = "send_to_tech"
	KindMarkResolved  ActionKind = "mark_resolved"
)

type ActionRequest struct {
	Kind   ActionKind     `json:"kind"`
	Action *SupportAction `json:"action,omitempty"`
}

// Check validates the request shape; the policy gate decides whether it may run.
func (r ActionRequest) Check() error {
	switch r.Kind {
	case KindSupportAction:
		if r.Action == nil {
			return Fail(ErrBadRequest, "support_action needs an action.")
		}
		if err := r.Action.Check(); err != nil {
			return Fail(ErrBadRequest, "Invalid action: %v.", err)
		}
	case KindSendToTech, KindMarkResolved:
		if r.Action != nil {
			return Fail(ErrBadRequest, "%s takes no action.", r.Kind)
		}
	default:
		return Fail(ErrBadRequest, "kind must be support_action, send_to_tech or mark_resolved.")
	}
	return nil
}

// Name is the audit step name of the request ("restore_access", "send_to_tech", ...).
func (r ActionRequest) Name() string {
	if r.Kind == KindSupportAction && r.Action != nil {
		return string(r.Action.Type)
	}
	return string(r.Kind)
}

type ActionResult struct {
	Status    string     `json:"status"` // executed | blocked
	Message   string     `json:"message"`
	Rule      string     `json:"rule"`
	TechIssue *TechIssue `json:"techIssue,omitempty"`
}

const (
	MaxReplyChars = 3000
	PreviewChars  = 120
)

// CheckReply trims and validates a support reply body (1–3000 chars).
func CheckReply(body string) (string, error) {
	text := strings.TrimSpace(body)
	if n := utf8.RuneCountInString(text); n < 1 || n > MaxReplyChars {
		return "", Fail(ErrBadRequest, "Reply must be 1-%d characters.", MaxReplyChars)
	}
	return text, nil
}

// Truncate cuts s to at most n runes.
func Truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
