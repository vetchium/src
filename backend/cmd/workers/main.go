package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"

	"backend/internal/config"
	"backend/internal/db"
	"backend/internal/db/sqlc"
	"backend/internal/workers"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	var err error
	if len(os.Args) > 1 && os.Args[1] == "readycheck" {
		err = readycheck()
	} else {
		err = run()
	}
	if err != nil {
		slog.Error("process exited with error", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
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

	var workerGroup sync.WaitGroup
	workerGroup.Add(1)
	go func() {
		defer workerGroup.Done()
		workers.RunExpireAdminSessions(ctx, sqlc.New(pool), log, workers.AdminSessionExpiryInterval)
	}()
	workers.RunHeartbeat(ctx, pool, log)
	workerGroup.Wait()
	return nil
}

func readycheck() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close(context.Background()) }()
	return conn.Ping(ctx)
}
