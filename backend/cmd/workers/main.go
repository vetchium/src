package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"backend/internal/db"
	"backend/internal/workers"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	if err := run(); err != nil {
		slog.Error("process exited with error", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := workers.LoadConfig()
	if err != nil {
		return err
	}

	log := slog.Default().With("tenant", cfg.TenantID, "component", "workers")
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL, log)
	if err != nil {
		return err
	}
	defer pool.Close()

	worker := workers.New(pool, log, cfg)
	worker.Run(ctx)
	<-ctx.Done()
	return nil
}
