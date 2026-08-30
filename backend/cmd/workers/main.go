package main

import (
	"log/slog"

	"backend/internal/appconfig"
	"backend/internal/db"
	"backend/internal/email"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/service"
	"backend/internal/workers"
)

func main() {
	service.MainWithoutServer("workers", run)
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

	log = service.WithTenant(log, cfg.TenantID)

	ctx, stop := service.SignalContext()
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
	hubCredentialKey := hubauthn.DeriveCredentialKey(
		cfg.TenantID, hubCredentialSecret,
	)
	worker := workers.New(
		pool, log, cfg.TenantID, cfg.Workers,
		&workers.HubEmailDelivery{
			TenantID: cfg.TenantID,
			Renderer: renderer,
			Sender:   sender,
			OutboxKey: hubauthn.DeriveCredentialSubkey(
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
