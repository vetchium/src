package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"backend/internal/appconfig"
	"backend/internal/db"
	"backend/internal/email"
	"backend/internal/hubapi"
	"backend/internal/workers"
)

func main() {
	handlerOptions := &slog.HandlerOptions{AddSource: true}
	handler := slog.NewJSONHandler(os.Stdout, handlerOptions)
	log := slog.New(handler).With("component", "workers")
	slog.SetDefault(log)

	if err := run(log); err != nil {
		log.Error(
			"process exited with error", "event", "process_exit", "error", err,
		)
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

	ctx, stop := signal.NotifyContext(
		context.Background(), os.Interrupt, syscall.SIGTERM,
	)
	defer stop()

	pool, err := db.Connect(ctx, databaseURL, log)
	if err != nil {
		return err
	}
	defer pool.Close()

	renderer, err := email.NewRenderer()
	if err != nil {
		return err
	}
	sender, err := email.NewSMTPSender(cfg.SMTP)
	if err != nil {
		return err
	}
	hubCredentialSecret, err := appconfig.HubCredentialSecret()
	if err != nil {
		return err
	}
	hubCredentialKey := hubapi.DeriveCredentialKey(
		cfg.TenantID, hubCredentialSecret,
	)
	worker := workers.New(
		pool, log, cfg.TenantID, cfg.Workers,
		&workers.HubEmailDelivery{
			TenantID: cfg.TenantID,
			Renderer: renderer,
			Sender:   sender,
			OutboxKey: hubapi.DeriveCredentialSubkey(
				hubCredentialKey, "outbox",
			),
			LeaseTTL:    cfg.Workers.HubEmailLeaseTTL,
			MaxAttempts: cfg.Workers.HubEmailMaxAttempts,
		},
	)
	worker.Run(ctx)
	<-ctx.Done()
	log.Info("shutdown requested", "event", "shutdown", "error", ctx.Err())
	return nil
}
