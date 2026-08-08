package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"backend/internal/appconfig"
	"backend/internal/db"
	"backend/internal/workers"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{AddSource: true})).With("component", "workers")
	slog.SetDefault(log)

	if err := run(log); err != nil {
		log.Error("process exited with error", "event", "process_exit", "error", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := appconfig.Load()
	if err != nil {
		return err
	}
	databaseURL, err := cfg.Database.URL()
	if err != nil {
		return err
	}

	log = log.With("tenant", cfg.TenantID)
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, databaseURL, log)
	if err != nil {
		return err
	}
	defer pool.Close()

	worker := workers.New(pool, log, cfg.Workers)
	worker.Run(ctx)
	<-ctx.Done()
	log.Info("shutdown requested", "event", "shutdown", "error", ctx.Err())
	return nil
}
