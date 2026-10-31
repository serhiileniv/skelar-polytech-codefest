// Command eval investigates the 7 demo cases on a fresh world, scores outcomes against docs/api.md → Demo cases,
// stores the score for GET /api/metrics, and restores the fresh world. Exit code 1 when any case is wrong.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/adapter/llm"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/config"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/repo/postgres"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/usecase"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/migrations"
)

func main() {
	ok, err := run()
	if err != nil {
		slog.Error("eval failed", "err", err)
		os.Exit(2)
	}
	if !ok {
		os.Exit(1)
	}
}

func run() (bool, error) {
	cfg, err := config.Load()
	if err != nil {
		return false, err
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	ctx := context.Background()
	pool, err := postgres.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return false, err
	}
	defer pool.Close()
	if err := postgres.Migrate(ctx, pool, migrations.FS, log); err != nil {
		return false, err
	}

	now := func() time.Time { return time.Now().UTC() }
	repo := postgres.NewCaseRepo(pool)
	model := llm.NewRouter(llm.Config{
		APIKey: cfg.AnthropicAPIKey, Model: cfg.AnthropicModel, ReplayDir: cfg.ReplayDir,
		ForceReplay: cfg.Replay, Record: cfg.Record, ReplayDelay: 0,
	})
	eval := usecase.NewRunEval(usecase.NewResetDemo(postgres.NewDemoStore(pool)), usecase.NewInvestigateCase(repo, model, now), repo, now)

	mode := "live " + cfg.AnthropicModel
	if model.Replaying() {
		mode = "replay"
	}
	fmt.Printf("eval · %s\n\n%-9s %-16s %-16s %-5s %s\n", mode, "case", "expected", "got", "steps", "")
	rows, correct, err := eval.Execute(ctx)
	for _, r := range rows {
		mark := "ok"
		if r.Err != nil {
			mark = "ERROR " + r.Err.Error()
		} else if r.Got != r.Expected {
			mark = "WRONG"
		}
		fmt.Printf("%-9s %-16s %-16s %-5d %s\n", r.CaseID, r.Expected, r.Got, r.Steps, mark)
	}
	fmt.Printf("\naccuracy %d/%d (stored for /api/metrics)\n", correct, len(rows))
	return err == nil && correct == len(rows), err
}
