package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// Fix-it writes (simulated store + email connectors act on the demo world tables).

// fixRecords adds what C1/E1 read to the gate's records. Subscriptions are locked like payments.
func fixRecords(ctx context.Context, tx pgx.Tx, customerID string, recs entity.CustomerRecords) (entity.CustomerRecords, error) {
	rows, err := tx.Query(ctx, `SELECT `+subCols+` FROM subscriptions WHERE customer_id = $1 ORDER BY id FOR UPDATE`, customerID)
	if recs.Subscriptions, err = collect(rows, err, scanSub); err != nil {
		return recs, err
	}
	rows, err = tx.Query(ctx, `SELECT id, customer_id, source, type, detail, app_version, at FROM session_events WHERE customer_id = $1 ORDER BY at, id`, customerID)
	recs.Events, err = collect(rows, err, func(row pgx.Rows) (entity.SessionEvent, error) {
		var e entity.SessionEvent
		return e, row.Scan(&e.ID, &e.CustomerID, &e.Source, &e.Type, &e.Detail, &e.AppVersion, &e.At)
	})
	if err != nil {
		return recs, err
	}
	rows, err = tx.Query(ctx, `SELECT id, customer_id, to_address, template, status, at FROM email_logs WHERE customer_id = $1 ORDER BY at, id`, customerID)
	recs.Emails, err = collect(rows, err, func(row pgx.Rows) (entity.EmailLog, error) {
		var e entity.EmailLog
		return e, row.Scan(&e.ID, &e.CustomerID, &e.To, &e.Template, &e.Status, &e.At)
	})
	return recs, err
}

func (t caseTx) CancelSubscription(ctx context.Context, subscriptionID string, at time.Time) error {
	return exactlyOne(t.tx.Exec(ctx, `UPDATE subscriptions SET status = 'canceled', canceled_at = $2, renews_at = NULL
		WHERE id = $1 AND status = 'active'`, subscriptionID, at))
}

func (t caseTx) AddEmail(ctx context.Context, customerID, template string, at time.Time) (string, error) {
	id, err := seqID(ctx, t.tx, "email_seq", "mail_r")
	if err != nil {
		return "", err
	}
	err = exactlyOne(t.tx.Exec(ctx, `INSERT INTO email_logs (id, customer_id, to_address, template, status, at)
		SELECT $1, id, email, $3, 'delivered', $4 FROM customers WHERE id = $2`, id, customerID, template, at))
	return id, err
}
