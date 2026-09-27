package main

import (
	"fmt"
	"log/slog"
	"net/http"

	"backend/internal/apiserver"
	"backend/internal/appconfig"
	"backend/internal/db"
	dbsqlc "backend/internal/db/sqlc"
	"backend/internal/directoryclient"
	"backend/internal/dnsverify"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	orgsauthn "backend/internal/orgs/auth"
	"backend/internal/orgs/domainverification"
	"backend/internal/orgs/signupcompletion"
	"backend/internal/regions"
	"backend/internal/routes"
	"backend/internal/service"
)

func main() {
	service.Main("orgs-api", run)
}

func run(log *slog.Logger, address string) error {
	cfg, err := appconfig.Load()
	if err != nil {
		return err
	}
	databaseURL, err := cfg.Database.URL()
	if err != nil {
		return err
	}
	credentialSecret, err := appconfig.OrgsCredentialSecret()
	if err != nil {
		return err
	}
	catalog, err := regions.Load(cfg.SignupRegionsFile)
	if err != nil {
		return err
	}
	if !catalog.HasOrgsOrigin(cfg.TenantID, cfg.OrgsAPIServer.PublicBaseURL) {
		return fmt.Errorf("tenant Org origin missing from signup catalog")
	}
	// Discovery advertises what the catalog says; this setting decides
	// whether Org signup is served. Refuse to start when they disagree.
	if catalog.OrgSignupEnabled(cfg.TenantID) !=
		cfg.OrgsAPIServer.Signup.Enabled {
		return fmt.Errorf(
			"signup catalog says orgSignupEnabled=%t for %q but orgsAPIServer.signup.enabled is %t",
			catalog.OrgSignupEnabled(cfg.TenantID), cfg.TenantID,
			cfg.OrgsAPIServer.Signup.Enabled,
		)
	}
	meshCredential, err := cfg.MeshAPIServer.Credential()
	if err != nil {
		return err
	}
	globalDirectory := directoryclient.New(
		cfg.MeshAPIServer.BaseURL, directoryclient.MeshPrefix,
		meshCredential, cfg.MeshAPIServer.RequestTimeout,
	)
	verification := cfg.OrgDomainVerification
	checker := dnsverify.New(
		verification.ResolverAddress, verification.LookupTimeout,
	)
	log = service.WithTenant(log, cfg.TenantID)

	ctx, stop := service.SignalContext()
	defer stop()

	pool, err := db.Connect(ctx, databaseURL, log)
	if err != nil {
		return err
	}
	defer pool.Close()

	credentialKey := orgsauthn.DeriveCredentialKey(
		cfg.TenantID, credentialSecret,
	)
	queries := dbsqlc.New(pool)
	s := &orgsruntime.Server{
		Runtime:   apiserver.New(pool, log),
		Queries:   queries,
		Directory: globalDirectory,
		Regions:   catalog,
		SignupCompletion: signupcompletion.New(
			pool, globalDirectory, checker, cfg.TenantID,
			orgsauthn.DeriveCredentialSubkey(
				credentialKey, "signup-provisioning",
			),
			verification.CheckInterval, nil,
		),
		Domains: domainverification.New(
			queries, globalDirectory, checker,
			domainverification.PolicyFrom(verification),
			cfg.TenantID,
			orgsauthn.DeriveCredentialSubkey(credentialKey, "outbox"), log,
		),
		Signup:        cfg.OrgsAPIServer.Signup,
		TenantID:      cfg.TenantID,
		SessionTTL:    cfg.OrgsAPIServer.SessionTTL,
		SignupTTL:     cfg.OrgsAPIServer.SignupTTL,
		PublicBaseURL: cfg.OrgsAPIServer.PublicBaseURL,
		CredentialKey: credentialKey,
	}
	mux := http.NewServeMux()
	routes.RegisterOrgsRoutes(mux, s)

	return service.ListenAndServe(
		ctx, log, address, middleware.RequestLogger(s.Runtime)(mux),
	)
}
