// Package postgres implements the usecase ports with pgx and hand-written SQL. No business decisions here.
package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

type DemoStore struct{ pool *pgxpool.Pool }

func NewDemoStore(pool *pgxpool.Pool) *DemoStore { return &DemoStore{pool: pool} }

// ReplaceWorld wipes all demo state (cases, board, audit, simulated records) and writes w, atomically.
// eval_runs is kept: eval history is not demo state.
func (s *DemoStore) ReplaceWorld(ctx context.Context, w entity.World) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `TRUNCATE audit_log, chat_messages, tech_issues, cases, email_logs, error_logs,
			session_events, entitlements, payments, subscriptions, help_articles, customers RESTART IDENTITY`); err != nil {
			return fmt.Errorf("truncate: %w", err)
		}
		for _, seq := range []string{"tech_issue_seq", "reply_seq", "email_seq"} {
			if _, err := tx.Exec(ctx, `ALTER SEQUENCE `+seq+` RESTART`); err != nil {
				return fmt.Errorf("restart %s: %w", seq, err)
			}
		}
		for _, t := range worldTables(w) {
			n, err := tx.CopyFrom(ctx, pgx.Identifier{t.name}, t.cols, pgx.CopyFromRows(t.rows))
			if err != nil {
				return fmt.Errorf("copy %s: %w", t.name, err)
			}
			if int(n) != len(t.rows) {
				return fmt.Errorf("copy %s: wrote %d of %d rows", t.name, n, len(t.rows))
			}
		}
		return nil
	})
}

type table struct {
	name string
	cols []string
	rows [][]any
}

// worldTables maps the world to rows in foreign-key order.
func worldTables(w entity.World) []table {
	customers := table{name: "customers", cols: []string{"id", "name", "email", "platform", "app_version", "country", "created_at"}}
	for _, c := range w.Customers {
		customers.rows = append(customers.rows, []any{c.ID, c.Name, c.Email, string(c.Platform), c.AppVersion, c.Country, c.CreatedAt})
	}
	subs := table{name: "subscriptions", cols: []string{"id", "customer_id", "channel", "plan", "price_usd", "status", "renews_at", "canceled_at"}}
	for _, x := range w.Subscriptions {
		subs.rows = append(subs.rows, []any{x.ID, x.CustomerID, string(x.Channel), string(x.Plan), x.PriceUSD, string(x.Status), x.RenewsAt, x.CanceledAt})
	}
	pays := table{name: "payments", cols: []string{"id", "customer_id", "subscription_id", "channel", "amount_usd", "status", "at"}}
	for _, x := range w.Payments {
		pays.rows = append(pays.rows, []any{x.ID, x.CustomerID, x.SubscriptionID, string(x.Channel), x.AmountUSD, string(x.Status), x.At})
	}
	ents := table{name: "entitlements", cols: []string{"id", "customer_id", "account_email", "active", "payment_id", "granted_at"}}
	for _, x := range w.Entitlements {
		ents.rows = append(ents.rows, []any{x.ID, x.CustomerID, x.AccountEmail, x.Active, x.PaymentID, x.GrantedAt})
	}
	evs := table{name: "session_events", cols: []string{"id", "customer_id", "source", "type", "detail", "app_version", "at"}}
	for _, x := range w.Events {
		evs.rows = append(evs.rows, []any{x.ID, x.CustomerID, string(x.Source), x.Type, x.Detail, x.AppVersion, x.At})
	}
	errs := table{name: "error_logs", cols: []string{"id", "customer_id", "service", "code", "message", "app_version", "at"}}
	for _, x := range w.Errors {
		var cust *string
		if x.CustomerID != "" {
			cust = &x.CustomerID
		}
		errs.rows = append(errs.rows, []any{x.ID, cust, x.Service, x.Code, x.Message, x.AppVersion, x.At})
	}
	mails := table{name: "email_logs", cols: []string{"id", "customer_id", "to_address", "template", "status", "at"}}
	for _, x := range w.Emails {
		mails.rows = append(mails.rows, []any{x.ID, x.CustomerID, x.To, x.Template, x.Status, x.At})
	}
	help := table{name: "help_articles", cols: []string{"id", "title", "steps", "tags"}}
	for _, x := range w.Help {
		help.rows = append(help.rows, []any{x.ID, x.Title, x.Steps, x.Tags})
	}
	cases := table{name: "cases", cols: []string{"id", "customer_id", "subject", "status", "created_at", "verdict", "outcome"}}
	msgs := table{name: "chat_messages", cols: []string{"id", "case_id", "sender", "body", "at"}}
	for _, c := range w.Cases {
		var outcome *string
		if c.Verdict != nil {
			o := string(c.Verdict.Outcome)
			outcome = &o
		}
		cases.rows = append(cases.rows, []any{c.ID, c.CustomerID, c.Subject, string(c.Status), c.CreatedAt, c.Verdict, outcome})
		for _, m := range c.Messages {
			msgs.rows = append(msgs.rows, []any{m.ID, c.ID, string(m.From), m.Body, m.At})
		}
	}
	return []table{customers, subs, pays, ents, evs, errs, mails, help, cases, msgs}
}
