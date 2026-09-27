package main

import (
	"log/slog"

	"backend/internal/appconfig"
	"backend/internal/db"
	dbsqlc "backend/internal/db/sqlc"
	"backend/internal/directoryclient"
	"backend/internal/dnsverify"
	"backend/internal/email"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/hub/signupcompletion"
	"backend/internal/objectstorage"
	orgsauthn "backend/internal/orgs/auth"
	"backend/internal/orgs/domainverification"
	orgsignup "backend/internal/orgs/signupcompletion"
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
	meshCredential, err := cfg.MeshAPIServer.Credential()
	if err != nil {
		return err
	}
	directory := directoryclient.New(
		cfg.MeshAPIServer.BaseURL, directoryclient.MeshPrefix,
		meshCredential, cfg.MeshAPIServer.RequestTimeout,
	)
	accessKey, secretKey, err := cfg.ObjectStorage.Credentials()
	if err != nil {
		return err
	}
	pictures, err := objectstorage.New(
		cfg.ObjectStorage.PrivateBaseURL, cfg.ObjectStorage.MediaBaseURL,
		accessKey, secretKey,
	)
	if err != nil {
		return err
	}
	if err := pictures.EnsureBucket(ctx); err != nil {
		return err
	}
	signupRecovery := signupcompletion.New(
		pool, directory, cfg.TenantID,
		hubauthn.DeriveCredentialSubkey(
			hubCredentialKey, "signup-provisioning",
		),
		nil,
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
		signupRecovery,
	)
	orgsCredentialSecret, err := appconfig.OrgsCredentialSecret()
	if err != nil {
		return err
	}
	orgsCredentialKey := orgsauthn.DeriveCredentialKey(
		cfg.TenantID, orgsCredentialSecret,
	)
	orgRenderer, err := email.NewOrgRenderer()
	if err != nil {
		return err
	}
	verification := cfg.OrgDomainVerification
	checker := dnsverify.New(
		verification.ResolverAddress, verification.LookupTimeout,
	)
	orgOutboxKey := orgsauthn.DeriveCredentialSubkey(orgsCredentialKey, "outbox")
	worker.EnableOrgs(cfg.Workers, workers.OrgWork{
		Email: workers.OrgEmailDelivery{
			Renderer: orgRenderer, Sender: sender, OutboxKey: orgOutboxKey,
			LeaseTTL:    cfg.Workers.OrgEmailLeaseTTL,
			MaxAttempts: cfg.Workers.OrgEmailMaxAttempts,
		},
		Signup: orgsignup.New(
			pool, directory, checker, cfg.TenantID,
			orgsauthn.DeriveCredentialSubkey(
				orgsCredentialKey, "signup-provisioning",
			),
			verification.CheckInterval, nil,
		),
		Domains: domainverification.New(
			dbsqlc.New(pool), directory, checker,
			domainverification.PolicyFrom(verification), cfg.TenantID,
			orgOutboxKey, log,
		),
	})
	worker.EnablePictureDeletion(pictures)
	worker.EnableAliasOperations(directory)
	worker.Run(ctx)
	<-ctx.Done()
	log.Info("shutdown requested", "event", "shutdown", "error", ctx.Err())
	return nil
}
