package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/usecase"
)

// CaseRepo implements the inbox, board, action/reply transaction, investigation and metrics ports.
type CaseRepo struct{ pool *pgxpool.Pool }

func NewCaseRepo(pool *pgxpool.Pool) *CaseRepo { return &CaseRepo{pool: pool} }

var (
	_ usecase.CaseReader         = (*CaseRepo)(nil)
	_ usecase.BoardReader        = (*CaseRepo)(nil)
	_ usecase.CaseStore          = (*CaseRepo)(nil)
	_ usecase.InvestigationStore = (*CaseRepo)(nil)
	_ usecase.MetricsStore       = (*CaseRepo)(nil)
)

// ---- reads (BE5) ----

func (r *CaseRepo) ListCases(ctx context.Context) ([]entity.CaseListItem, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT c.id, c.subject, cu.name, c.status, c.outcome, c.created_at,
		       coalesce((SELECT m.body FROM chat_messages m WHERE m.case_id = c.id ORDER BY m.at DESC, m.id DESC LIMIT 1), '')
		FROM cases c JOIN customers cu ON cu.id = c.customer_id
		ORDER BY c.created_at DESC, c.id DESC`)
	return collect(rows, err, func(row pgx.Rows) (entity.CaseListItem, error) {
		var it entity.CaseListItem
		var last string
		err := row.Scan(&it.ID, &it.Subject, &it.CustomerName, &it.Status, &it.Outcome, &it.CreatedAt, &last)
		it.Preview = entity.Truncate(last, entity.PreviewChars)
		return it, err
	})
}

func (r *CaseRepo) CaseDetail(ctx context.Context, caseID string) (entity.CaseDetail, error) {
	var d entity.CaseDetail
	kase, err := getCase(ctx, r.pool, caseID, false)
	if err != nil {
		return d, err
	}
	// Every query below is scoped by the customer id read from the case row.
	d.Case = kase
	if d.Customer, err = getCustomer(ctx, r.pool, kase.CustomerID); err != nil {
		return d, err
	}
	if d.Subscriptions, err = listSubs(ctx, r.pool, kase.CustomerID); err != nil {
		return d, err
	}
	if d.Payments, err = listPays(ctx, r.pool, kase.CustomerID); err != nil {
		return d, err
	}
	if d.Entitlements, err = listEnts(ctx, r.pool, kase.CustomerID); err != nil {
		return d, err
	}
	d.Audit, err = listAudit(ctx, r.pool, caseID)
	return d, err
}

func (r *CaseRepo) ListTechIssues(ctx context.Context) ([]entity.TechIssue, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+techCols+` FROM tech_issues ORDER BY created_at DESC, id DESC`)
	return collect(rows, err, func(row pgx.Rows) (entity.TechIssue, error) { return scanTech(row) })
}

// ---- action / reply transaction (BE6) ----

func (r *CaseRepo) InTx(ctx context.Context, fn func(tx usecase.CaseTx) error) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error { return fn(caseTx{tx}) })
}

type caseTx struct{ tx pgx.Tx }

func (t caseTx) LockCase(ctx context.Context, caseID string) (entity.Case, error) {
	return getCase(ctx, t.tx, caseID, true)
}

func (t caseTx) CustomerRecords(ctx context.Context, customerID string) (entity.CustomerRecords, error) {
	var recs entity.CustomerRecords
	var err error
	// FOR UPDATE: two clicks on the same refund serialise here, so P3 holds.
	rows, err := t.tx.Query(ctx, `SELECT `+entCols+` FROM entitlements WHERE customer_id = $1 ORDER BY id FOR UPDATE`, customerID)
	if recs.Entitlements, err = collect(rows, err, scanEnt); err != nil {
		return recs, err
	}
	rows, err = t.tx.Query(ctx, `SELECT `+payCols+` FROM payments WHERE customer_id = $1 ORDER BY at, id FOR UPDATE`, customerID)
	recs.Payments, err = collect(rows, err, scanPay)
	return recs, err
}

func (t caseTx) Billing(ctx context.Context) (entity.Billing, error) { return billing(ctx, t.tx) }

func (t caseTx) RestoreEntitlement(ctx context.Context, entitlementID, paymentID string, at time.Time) error {
	return exactlyOne(t.tx.Exec(ctx, `UPDATE entitlements SET active = true, payment_id = $2, granted_at = $3 WHERE id = $1`, entitlementID, paymentID, at))
}

func (t caseTx) RefundPayment(ctx context.Context, paymentID string) error {
	return exactlyOne(t.tx.Exec(ctx, `UPDATE payments SET status = 'refunded' WHERE id = $1 AND status <> 'refunded'`, paymentID))
}

func (t caseTx) SetCaseStatus(ctx context.Context, caseID string, status entity.CaseStatus) error {
	return exactlyOne(t.tx.Exec(ctx, `UPDATE cases SET status = $2 WHERE id = $1`, caseID, string(status)))
}

func (t caseTx) OpenTechIssue(ctx context.Context, sig entity.Signature) (*entity.TechIssue, error) {
	ti, err := scanTech(t.tx.QueryRow(ctx, `SELECT `+techCols+` FROM tech_issues WHERE signature = $1 AND status <> 'resolved' FOR UPDATE`, string(sig)))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &ti, nil
}

func (t caseTx) NextTechIssueID(ctx context.Context) (string, error) {
	return seqID(ctx, t.tx, "tech_issue_seq", "tech_")
}

func (t caseTx) SaveTechIssue(ctx context.Context, ti entity.TechIssue) error {
	_, err := t.tx.Exec(ctx, `
		INSERT INTO tech_issues (`+techCols+`) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (id) DO UPDATE SET evidence_ids = EXCLUDED.evidence_ids, case_ids = EXCLUDED.case_ids,
			affected_customer_ids = EXCLUDED.affected_customer_ids, status = EXCLUDED.status`,
		ti.ID, string(ti.Signature), ti.Title, ti.RootCause, ti.EvidenceIDs, ti.CaseIDs, ti.AffectedCustomerIDs, string(ti.Status), ti.CreatedAt)
	return err
}

func (t caseTx) NextReplyID(ctx context.Context) (string, error) {
	return seqID(ctx, t.tx, "reply_seq", "msg_r")
}

func (t caseTx) AddMessage(ctx context.Context, caseID string, m entity.ChatMessage) error {
	_, err := t.tx.Exec(ctx, `INSERT INTO chat_messages (id, case_id, sender, body, at) VALUES ($1, $2, $3, $4, $5)`,
		m.ID, caseID, string(m.From), m.Body, m.At)
	return err
}

func (t caseTx) AppendAudit(ctx context.Context, e entity.AuditEntry) error {
	return appendAudit(ctx, t.tx, e)
}

// ---- investigation store (BE7) ----

func (r *CaseRepo) Case(ctx context.Context, caseID string) (entity.Case, error) {
	return getCase(ctx, r.pool, caseID, false)
}

func (r *CaseRepo) Customer(ctx context.Context, id string) (entity.Customer, error) {
	return getCustomer(ctx, r.pool, id)
}

func (r *CaseRepo) Subscriptions(ctx context.Context, customerID string) ([]entity.Subscription, error) {
	return listSubs(ctx, r.pool, customerID)
}

func (r *CaseRepo) Payments(ctx context.Context, customerID string) ([]entity.Payment, error) {
	return listPays(ctx, r.pool, customerID)
}

func (r *CaseRepo) Entitlements(ctx context.Context, customerID string) ([]entity.Entitlement, error) {
	return listEnts(ctx, r.pool, customerID)
}

func (r *CaseRepo) Events(ctx context.Context, customerID string) ([]entity.SessionEvent, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, customer_id, source, type, detail, app_version, at FROM session_events WHERE customer_id = $1 ORDER BY at, id`, customerID)
	return collect(rows, err, func(row pgx.Rows) (entity.SessionEvent, error) {
		var e entity.SessionEvent
		return e, row.Scan(&e.ID, &e.CustomerID, &e.Source, &e.Type, &e.Detail, &e.AppVersion, &e.At)
	})
}

func (r *CaseRepo) Errors(ctx context.Context, customerID string) ([]entity.ErrorLog, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, coalesce(customer_id, ''), service, code, message, app_version, at FROM error_logs WHERE customer_id = $1 ORDER BY at, id`, customerID)
	return collect(rows, err, func(row pgx.Rows) (entity.ErrorLog, error) {
		var e entity.ErrorLog
		return e, row.Scan(&e.ID, &e.CustomerID, &e.Service, &e.Code, &e.Message, &e.AppVersion, &e.At)
	})
}

func (r *CaseRepo) Emails(ctx context.Context, customerID string) ([]entity.EmailLog, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, customer_id, to_address, template, status, at FROM email_logs WHERE customer_id = $1 ORDER BY at, id`, customerID)
	return collect(rows, err, func(row pgx.Rows) (entity.EmailLog, error) {
		var e entity.EmailLog
		return e, row.Scan(&e.ID, &e.CustomerID, &e.To, &e.Template, &e.Status, &e.At)
	})
}

func (r *CaseRepo) HelpArticles(ctx context.Context) ([]entity.HelpArticle, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, title, steps, tags FROM help_articles ORDER BY id`)
	return collect(rows, err, func(row pgx.Rows) (entity.HelpArticle, error) {
		var a entity.HelpArticle
		return a, row.Scan(&a.ID, &a.Title, &a.Steps, &a.Tags)
	})
}

func (r *CaseRepo) Billing(ctx context.Context) (entity.Billing, error) { return billing(ctx, r.pool) }

func (r *CaseRepo) AppendAudit(ctx context.Context, e entity.AuditEntry) error {
	return appendAudit(ctx, r.pool, e)
}

func (r *CaseRepo) SaveVerdict(ctx context.Context, caseID string, v entity.Verdict) error {
	body, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return exactlyOne(r.pool.Exec(ctx, `UPDATE cases SET verdict = $2, outcome = $3 WHERE id = $1`, caseID, body, string(v.Outcome)))
}

// ---- metrics (BE9) ----

func (r *CaseRepo) MetricsInputs(ctx context.Context) (int, []entity.Verdict, entity.ActionCounts, *entity.EvalResult, error) {
	var total int
	var actions entity.ActionCounts
	if err := r.pool.QueryRow(ctx, `SELECT count(*) FROM cases`).Scan(&total); err != nil {
		return 0, nil, actions, nil, err
	}
	rows, err := r.pool.Query(ctx, `SELECT verdict FROM cases WHERE verdict IS NOT NULL ORDER BY id`)
	verdicts, err := collect(rows, err, func(row pgx.Rows) (entity.Verdict, error) {
		var raw []byte
		var v entity.Verdict
		if err := row.Scan(&raw); err != nil {
			return v, err
		}
		return v, json.Unmarshal(raw, &v)
	})
	if err != nil {
		return 0, nil, actions, nil, err
	}
	err = r.pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE actor = 'support' AND step IN ('restore_access', 'refund_payment', 'send_to_tech', 'mark_resolved')),
		       count(*) FILTER (WHERE step LIKE 'blocked:%')
		FROM audit_log`).Scan(&actions.Executed, &actions.Blocked)
	if err != nil {
		return 0, nil, actions, nil, err
	}
	var ev entity.EvalResult
	err = r.pool.QueryRow(ctx, `SELECT correct, total, ran_at FROM eval_runs ORDER BY id DESC LIMIT 1`).Scan(&ev.Correct, &ev.Total, &ev.RanAt)
	if err == pgx.ErrNoRows {
		return total, verdicts, actions, nil, nil
	}
	if err != nil {
		return 0, nil, actions, nil, err
	}
	return total, verdicts, actions, &ev, nil
}

func (r *CaseRepo) SaveEvalRun(ctx context.Context, correct, total int, at time.Time) error {
	_, err := r.pool.Exec(ctx, `INSERT INTO eval_runs (correct, total, ran_at) VALUES ($1, $2, $3)`, correct, total, at)
	return err
}

// ---- helpers ----

func billing(ctx context.Context, q querier) (entity.Billing, error) {
	var b entity.Billing
	rows, err := q.Query(ctx, `SELECT `+subCols+` FROM subscriptions ORDER BY id`)
	if b.Subscriptions, err = collect(rows, err, scanSub); err != nil {
		return b, err
	}
	rows, err = q.Query(ctx, `SELECT `+payCols+` FROM payments ORDER BY id`)
	if b.Payments, err = collect(rows, err, scanPay); err != nil {
		return b, err
	}
	rows, err = q.Query(ctx, `SELECT `+entCols+` FROM entitlements ORDER BY id`)
	b.Entitlements, err = collect(rows, err, scanEnt)
	return b, err
}

type rowsAffected interface{ RowsAffected() int64 }

func exactlyOne[T rowsAffected](tag T, err error) error {
	if err != nil {
		return err
	}
	if n := tag.RowsAffected(); n != 1 {
		return fmt.Errorf("expected 1 row changed, got %d", n)
	}
	return nil
}
