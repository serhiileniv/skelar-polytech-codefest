// Command seed migrates the database and replaces all data with the deterministic demo world.
//
//	go run ./cmd/seed               # migrate + seed
//	go run ./cmd/seed -migrate-only # migrate only
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/config"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/repo/postgres"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/usecase"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/migrations"
)

func main() {
	migrateOnly := flag.Bool("migrate-only", false, "apply migrations and exit")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(log, *migrateOnly); err != nil {
		log.Error("seed failed", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger, migrateOnly bool) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx := context.Background()
	pool, err := postgres.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := postgres.Migrate(ctx, pool, migrations.FS, log); err != nil {
		return err
	}
	if migrateOnly {
		log.Info("migrations up to date")
		return nil
	}
	w, err := usecase.NewResetDemo(postgres.NewDemoStore(pool)).Execute(ctx)
	if err != nil {
		return err
	}
	log.Info("demo world seeded",
		"customers", len(w.Customers), "subscriptions", len(w.Subscriptions), "payments", len(w.Payments),
		"entitlements", len(w.Entitlements), "events", len(w.Events), "errors", len(w.Errors),
		"emails", len(w.Emails), "help", len(w.Help), "cases", len(w.Cases))
	return nil
}
