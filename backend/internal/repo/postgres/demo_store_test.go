package postgres

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/seed"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/migrations"
)

// Runs against a real postgres: `make test-db`. Skipped unless TEST_DATABASE_URL is set. Re-seeds the DB.
func TestReplaceWorld(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := Migrate(ctx, pool, migrations.FS, slog.New(slog.NewTextHandler(io.Discard, nil))); err != nil {
		t.Fatal(err)
	}

	w := seed.World()
	store := NewDemoStore(pool)
	// Twice: replacing must be idempotent, not append.
	for range 2 {
		if err := store.ReplaceWorld(ctx, w); err != nil {
			t.Fatal(err)
		}
	}

	count := func(q string) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, q).Scan(&n); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		return n
	}
	tests := []struct {
		query string
		want  int
	}{
		{`SELECT count(*) FROM customers`, 91},
		{`SELECT count(*) FROM subscriptions`, len(w.Subscriptions)},
		{`SELECT count(*) FROM payments`, len(w.Payments)},
		{`SELECT count(*) FROM entitlements`, len(w.Entitlements)},
		{`SELECT count(*) FROM session_events`, len(w.Events)},
		{`SELECT count(*) FROM error_logs`, len(w.Errors)},
		{`SELECT count(*) FROM email_logs`, 3},
		{`SELECT count(*) FROM help_articles`, 6},
		{`SELECT count(*) FROM cases WHERE status = 'open' AND verdict IS NULL`, 7},
		{`SELECT count(*) FROM chat_messages`, 10},
		{`SELECT count(*) FROM tech_issues`, 0},
		{`SELECT count(*) FROM audit_log`, 0},
		// cancel_not_synced signature in SQL: web cancel → succeeded App Store charge within 60 min.
		{`SELECT count(DISTINCT s.customer_id) FROM subscriptions s
		  JOIN payments p ON p.customer_id = s.customer_id AND p.channel = 'app_store' AND p.status = 'succeeded'
		   AND p.at > s.canceled_at AND p.at <= s.canceled_at + interval '60 minutes'
		  WHERE s.channel = 'web' AND s.status = 'canceled'`, 38},
		{`SELECT count(*) FROM payments WHERE id = 'pay_0003' AND amount_usd = 29.99 AND at = '2026-10-31T09:00:00Z'`, 1},
		{`SELECT count(*) FROM entitlements WHERE id = 'ent_0003' AND NOT active AND payment_id IS NULL`, 1},
		{`SELECT count(*) FROM chat_messages WHERE case_id = 'case_107' AND body LIKE '%SYSTEM OVERRIDE%'`, 1},
	}
	for _, tt := range tests {
		if got := count(tt.query); got != tt.want {
			t.Errorf("%s = %d, want %d", tt.query, got, tt.want)
		}
	}

	// Timestamps come back in UTC, so JSON matches the contract ("2026-10-31T09:00:00Z").
	var at time.Time
	if err := pool.QueryRow(ctx, `SELECT at FROM payments WHERE id = 'pay_0003'`).Scan(&at); err != nil {
		t.Fatal(err)
	}
	if b, _ := json.Marshal(at); string(b) != `"2026-10-31T09:00:00Z"` {
		t.Errorf("timestamp JSON = %s", b)
	}
}
