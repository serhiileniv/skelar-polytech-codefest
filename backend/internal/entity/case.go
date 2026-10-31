package entity

import "time"

type CaseStatus string

const (
	CaseOpen            CaseStatus = "open"
	CaseWaitingCustomer CaseStatus = "waiting_customer"
	CaseWithTech        CaseStatus = "with_tech"
	CaseResolved        CaseStatus = "resolved"
)

type Outcome string

const (
	OutcomeUserCanFix    Outcome = "user_can_fix"
	OutcomeSupportCanFix Outcome = "support_can_fix"
	OutcomeTechTeam      Outcome = "tech_team"
	OutcomeNeedMoreInfo  Outcome = "need_more_info"
	OutcomeSuspicious    Outcome = "suspicious"
)

// Outcomes lists every outcome in a stable order (metrics need every key present).
var Outcomes = []Outcome{OutcomeUserCanFix, OutcomeSupportCanFix, OutcomeTechTeam, OutcomeNeedMoreInfo, OutcomeSuspicious}

type Signature string

const (
	SignatureCancelNotSynced        Signature = "cancel_not_synced"
	SignatureEntitlementGrantFailed Signature = "entitlement_grant_failed"
	SignatureDuplicateCharge        Signature = "duplicate_charge"
)

type MessageFrom string

const (
	FromCustomer MessageFrom = "customer"
	FromSupport  MessageFrom = "support"
)

type ChatMessage struct {
	ID   string      `json:"id"`
	From MessageFrom `json:"from"`
	Body string      `json:"body"`
	At   time.Time   `json:"at"`
}

type SupportActionType string

const (
	ActionRestoreAccess SupportActionType = "restore_access"
	ActionRefundPayment SupportActionType = "refund_payment"
	// Fix-it (contract v2): act on the customer's behalf through simulated connectors.
	ActionCancelSubscription SupportActionType = "cancel_subscription"
	ActionSendMagicLink      SupportActionType = "send_magic_link"
)

// SupportAction is the docs/api.md union: restore_access carries EntitlementID, refund_payment carries PaymentID,
// cancel_subscription carries SubscriptionID, send_magic_link carries no target.
type SupportAction struct {
	Type           SupportActionType `json:"type"`
	EntitlementID  string            `json:"entitlementId,omitempty"`
	PaymentID      string            `json:"paymentId,omitempty"`
	SubscriptionID string            `json:"subscriptionId,omitempty"`
	Reason         string            `json:"reason"`
}

type Evidence struct {
	ID   string `json:"id"`
	Note string `json:"note"`
}

type TechIssueRef struct {
	Signature Signature `json:"signature"`
	Title     string    `json:"title"`
	RootCause string    `json:"rootCause"`
}

type Verdict struct {
	Outcome            Outcome        `json:"outcome"`
	ModelOutcome       Outcome        `json:"modelOutcome"`
	Downgraded         bool           `json:"downgraded"`
	ValidationNotes    []string       `json:"validationNotes"`
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
	StepsUsed          int            `json:"stepsUsed"`
	CreatedAt          time.Time      `json:"createdAt"`
}

type Case struct {
	ID         string        `json:"id"`
	CustomerID string        `json:"customerId"`
	Subject    string        `json:"subject"`
	Messages   []ChatMessage `json:"messages"`
	Status     CaseStatus    `json:"status"`
	CreatedAt  time.Time     `json:"createdAt"`
	Verdict    *Verdict      `json:"verdict"`
}

type Actor string

const (
	ActorAI      Actor = "ai"
	ActorSupport Actor = "support"
	ActorSystem  Actor = "system"
)

type AuditEntry struct {
	ID     string    `json:"id"`
	CaseID string    `json:"caseId"`
	Actor  Actor     `json:"actor"`
	Step   string    `json:"step"` // tool:getBilling, verdict_submitted, blocked:refund_payment, restore_access, ...
	Detail string    `json:"detail"`
	At     time.Time `json:"at"`
}

type TechIssueStatus string

const (
	TechIssueNew        TechIssueStatus = "new"
	TechIssueInProgress TechIssueStatus = "in_progress"
	TechIssueResolved   TechIssueStatus = "resolved"
)

type TechIssue struct {
	ID                  string          `json:"id"`
	Signature           Signature       `json:"signature"`
	Title               string          `json:"title"`
	RootCause           string          `json:"rootCause"`
	EvidenceIDs         []string        `json:"evidenceIds"`
	CaseIDs             []string        `json:"caseIds"`
	AffectedCustomerIDs []string        `json:"affectedCustomerIds"`
	Status              TechIssueStatus `json:"status"`
	CreatedAt           time.Time       `json:"createdAt"`
}
