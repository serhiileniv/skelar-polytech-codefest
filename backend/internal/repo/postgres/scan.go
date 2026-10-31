package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// querier is satisfied by *pgxpool.Pool and pgx.Tx, so every read works inside or outside a transaction.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

const (
	subCols   = `id, customer_id, channel, plan, price_usd::float8, status, renews_at, canceled_at`
	payCols   = `id, customer_id, subscription_id, channel, amount_usd::float8, status, at`
	entCols   = `id, customer_id, account_email, active, payment_id, granted_at`
	custCols  = `id, name, email, platform, app_version, country, created_at`
	techCols  = `id, signature, title, root_cause, evidence_ids, case_ids, affected_customer_ids, status, created_at`
	auditCols = `id, case_id, actor, step, detail, at`
)

func collect[T any](rows pgx.Rows, err error, scan func(pgx.Rows) (T, error)) ([]T, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []T{}
	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func scanSub(r pgx.Rows) (entity.Subscription, error) {
	var s entity.Subscription
	err := r.Scan(&s.ID, &s.CustomerID, &s.Channel, &s.Plan, &s.PriceUSD, &s.Status, &s.RenewsAt, &s.CanceledAt)
	return s, err
}

func scanPay(r pgx.Rows) (entity.Payment, error) {
	var p entity.Payment
	err := r.Scan(&p.ID, &p.CustomerID, &p.SubscriptionID, &p.Channel, &p.AmountUSD, &p.Status, &p.At)
	return p, err
}

func scanEnt(r pgx.Rows) (entity.Entitlement, error) {
	var e entity.Entitlement
	err := r.Scan(&e.ID, &e.CustomerID, &e.AccountEmail, &e.Active, &e.PaymentID, &e.GrantedAt)
	return e, err
}

func scanCustomer(r pgx.Row) (entity.Customer, error) {
	var c entity.Customer
	err := r.Scan(&c.ID, &c.Name, &c.Email, &c.Platform, &c.AppVersion, &c.Country, &c.CreatedAt)
	return c, err
}

func scanTech(r pgx.Row) (entity.TechIssue, error) {
	var t entity.TechIssue
	err := r.Scan(&t.ID, &t.Signature, &t.Title, &t.RootCause, &t.EvidenceIDs, &t.CaseIDs, &t.AffectedCustomerIDs, &t.Status, &t.CreatedAt)
	return t, err
}

func scanAudit(r pgx.Rows) (entity.AuditEntry, error) {
	var a entity.AuditEntry
	var id int64
	err := r.Scan(&id, &a.CaseID, &a.Actor, &a.Step, &a.Detail, &a.At)
	a.ID = auditID(id)
	return a, err
}

func auditID(n int64) string { return fmt.Sprintf("aud_%04d", n) }

func listSubs(ctx context.Context, q querier, customerID string) ([]entity.Subscription, error) {
	rows, err := q.Query(ctx, `SELECT `+subCols+` FROM subscriptions WHERE customer_id = $1 ORDER BY id`, customerID)
	return collect(rows, err, scanSub)
}

func listPays(ctx context.Context, q querier, customerID string) ([]entity.Payment, error) {
	rows, err := q.Query(ctx, `SELECT `+payCols+` FROM payments WHERE customer_id = $1 ORDER BY at, id`, customerID)
	return collect(rows, err, scanPay)
}

func listEnts(ctx context.Context, q querier, customerID string) ([]entity.Entitlement, error) {
	rows, err := q.Query(ctx, `SELECT `+entCols+` FROM entitlements WHERE customer_id = $1 ORDER BY id`, customerID)
	return collect(rows, err, scanEnt)
}

func listAudit(ctx context.Context, q querier, caseID string) ([]entity.AuditEntry, error) {
	rows, err := q.Query(ctx, `SELECT `+auditCols+` FROM audit_log WHERE case_id = $1 ORDER BY id`, caseID)
	return collect(rows, err, scanAudit)
}

func getCustomer(ctx context.Context, q querier, id string) (entity.Customer, error) {
	c, err := scanCustomer(q.QueryRow(ctx, `SELECT `+custCols+` FROM customers WHERE id = $1`, id))
	if err == pgx.ErrNoRows {
		return c, entity.Fail(entity.ErrNotFound, "Customer %s not found.", id)
	}
	return c, err
}

// getCase loads a case with its messages and verdict. forUpdate locks the row (actions serialise on it).
func getCase(ctx context.Context, q querier, id string, forUpdate bool) (entity.Case, error) {
	var c entity.Case
	var verdict []byte
	sql := `SELECT id, customer_id, subject, status, created_at, verdict FROM cases WHERE id = $1`
	if forUpdate {
		sql += ` FOR UPDATE`
	}
	err := q.QueryRow(ctx, sql, id).Scan(&c.ID, &c.CustomerID, &c.Subject, &c.Status, &c.CreatedAt, &verdict)
	if err == pgx.ErrNoRows {
		return c, entity.Fail(entity.ErrNotFound, "Case %s not found.", id)
	}
	if err != nil {
		return c, err
	}
	if verdict != nil {
		var v entity.Verdict
		if err := json.Unmarshal(verdict, &v); err != nil {
			return c, fmt.Errorf("decode verdict of %s: %w", id, err)
		}
		c.Verdict = &v
	}
	rows, err := q.Query(ctx, `SELECT id, sender, body, at FROM chat_messages WHERE case_id = $1 ORDER BY at, id`, id)
	c.Messages, err = collect(rows, err, func(r pgx.Rows) (entity.ChatMessage, error) {
		var m entity.ChatMessage
		return m, r.Scan(&m.ID, &m.From, &m.Body, &m.At)
	})
	return c, err
}

func appendAudit(ctx context.Context, q querier, e entity.AuditEntry) error {
	at := e.At
	if at.IsZero() {
		at = time.Now()
	}
	_, err := q.Exec(ctx, `INSERT INTO audit_log (case_id, actor, step, detail, at) VALUES ($1, $2, $3, $4, $5)`,
		e.CaseID, string(e.Actor), e.Step, e.Detail, at)
	return err
}

func seqID(ctx context.Context, q querier, seq, prefix string) (string, error) {
	var n int64
	if err := q.QueryRow(ctx, `SELECT nextval('`+seq+`')`).Scan(&n); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s%04d", prefix, n), nil
}
