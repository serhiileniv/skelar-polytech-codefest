// Command api is the Verdict HTTP server. All wiring happens here.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/adapter/llm"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/config"
	httpctl "github.com/serhiileniv/skelar-polytech-codefest/backend/internal/controller/http"
	mcpctl "github.com/serhiileniv/skelar-polytech-codefest/backend/internal/controller/mcp"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/repo/memory"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/repo/postgres"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/usecase"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/migrations"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: cfg.LogLevel}))
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := postgres.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := postgres.Migrate(ctx, pool, migrations.FS, log); err != nil {
		return err
	}

	// Wiring: repos → use cases → controllers.
	now := func() time.Time { return time.Now().UTC() }
	repo := postgres.NewCaseRepo(pool)
	model := llm.NewRouter(llm.Config{
		APIKey: cfg.GroqAPIKey, Model: cfg.GroqModel, BaseURL: cfg.GroqBaseURL, ReplayDir: cfg.ReplayDir,
		ForceReplay: cfg.Replay, Record: cfg.Record, ReplayDelay: cfg.ReplayDelay,
	})
	if cfg.GroqAPIKey == "" && !cfg.Replay {
		log.Warn("GROQ_API_KEY is not set: running in replay mode")
	}
	actions := usecase.NewExecuteAction(repo, now)
	replies := usecase.NewReplyToCase(repo, repo, now)
	fixPlans := memory.NewFixPlans()
	fixes := usecase.NewFixCase(repo, model, fixPlans, now)
	handler := httpctl.NewRouter(httpctl.Deps{
		DB:              pool,
		Cases:           usecase.NewReadCases(repo, repo),
		Actions:         actions,
		Replies:         replies,
		Fixes:           fixes,
		FixApprovals:    usecase.NewApproveFix(fixPlans, actions, replies, repo, now),
		MCP:             mcpctl.Handler(fixes, log),
		Asks:            usecase.NewAskCase(repo, model),
		Investigations:  usecase.NewInvestigateCase(repo, model, now),
		Metrics:         usecase.NewGetMetrics(repo),
		Reset:           usecase.NewResetDemo(postgres.NewDemoStore(pool)),
		FrontendOrigins: cfg.FrontendOrigins,
		Log:             log,
	})

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		// No WriteTimeout: the investigate SSE stream is long-lived.
	}

	errc := make(chan error, 1)
	go func() {
		log.Info("api listening", "addr", cfg.HTTPAddr, "frontendOrigins", cfg.FrontendOrigins,
			"model", cfg.GroqModel, "replay", model.Replaying(), "record", cfg.Record)
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		log.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
	return nil
}
