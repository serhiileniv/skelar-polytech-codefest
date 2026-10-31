package usecase

import (
	"context"
	"time"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// Clock returns the current time (injected so tests are deterministic).
type Clock func() time.Time

// CaseReader serves the inbox (GET /api/cases, GET /api/cases/{id}).
type CaseReader interface {
	ListCases(ctx context.Context) ([]entity.CaseListItem, error)
	CaseDetail(ctx context.Context, caseID string) (entity.CaseDetail, error)
}

// BoardReader serves GET /api/board.
type BoardReader interface {
	ListTechIssues(ctx context.Context) ([]entity.TechIssue, error)
}

// CaseStore runs a function in one SQL transaction (actions, replies).
type CaseStore interface {
	InTx(ctx context.Context, fn func(tx CaseTx) error) error
}

// CaseTx is everything an action or reply may read or change. Every call is scoped by ids the use case derived
// from the case row, never from the request body.
type CaseTx interface {
	LockCase(ctx context.Context, caseID string) (entity.Case, error)
	CustomerRecords(ctx context.Context, customerID string) (entity.CustomerRecords, error)
	Billing(ctx context.Context) (entity.Billing, error)
	RestoreEntitlement(ctx context.Context, entitlementID, paymentID string, at time.Time) error
	RefundPayment(ctx context.Context, paymentID string) error
	CancelSubscription(ctx context.Context, subscriptionID string, at time.Time) error
	// AddEmail logs an email to the customer's own address and returns its new id.
	AddEmail(ctx context.Context, customerID, template string, at time.Time) (string, error)
	SetCaseStatus(ctx context.Context, caseID string, status entity.CaseStatus) error
	OpenTechIssue(ctx context.Context, sig entity.Signature) (*entity.TechIssue, error)
	// OpenTechIssueForCase is the unresolved card that lists the case (T2), or nil.
	OpenTechIssueForCase(ctx context.Context, caseID string) (*entity.TechIssue, error)
	NextTechIssueID(ctx context.Context) (string, error)
	SaveTechIssue(ctx context.Context, t entity.TechIssue) error
	NextReplyID(ctx context.Context) (string, error)
	AddMessage(ctx context.Context, caseID string, m entity.ChatMessage) error
	AppendAudit(ctx context.Context, e entity.AuditEntry) error
}

// InvestigationStore is the read side of the agent's tools plus where its result goes.
type InvestigationStore interface {
	Case(ctx context.Context, caseID string) (entity.Case, error)
	Customer(ctx context.Context, customerID string) (entity.Customer, error)
	Subscriptions(ctx context.Context, customerID string) ([]entity.Subscription, error)
	Payments(ctx context.Context, customerID string) ([]entity.Payment, error)
	Entitlements(ctx context.Context, customerID string) ([]entity.Entitlement, error)
	Events(ctx context.Context, customerID string) ([]entity.SessionEvent, error)
	Errors(ctx context.Context, customerID string) ([]entity.ErrorLog, error)
	Emails(ctx context.Context, customerID string) ([]entity.EmailLog, error)
	HelpArticles(ctx context.Context) ([]entity.HelpArticle, error)
	Billing(ctx context.Context) (entity.Billing, error)
	ListTechIssues(ctx context.Context) ([]entity.TechIssue, error) // T2 dry run: is a ticket already open for the case
	AppendAudit(ctx context.Context, e entity.AuditEntry) error
	SaveVerdict(ctx context.Context, caseID string, v entity.Verdict) error
}

// MetricsStore feeds GET /api/metrics and stores `make eval` results.
type MetricsStore interface {
	MetricsInputs(ctx context.Context) (totalCases int, verdicts []entity.Verdict, actions entity.ActionCounts, eval *entity.EvalResult, err error)
	SaveEvalRun(ctx context.Context, correct, total int, at time.Time) error
}
