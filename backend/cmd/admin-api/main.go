package main

import (
	"log/slog"
	"net/http"

	adminruntime "backend/internal/admin"
	adminauthn "backend/internal/admin/auth"
	"backend/internal/apiserver"
	"backend/internal/appconfig"
	"backend/internal/db"
	dbsqlc "backend/internal/db/sqlc"
	"backend/internal/middleware"
	"backend/internal/routes"
	"backend/internal/service"
)

func main() {
	service.Main("admin-api", run)
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
	credentialSecret, err := appconfig.AdminCredentialSecret()
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

	s := &adminruntime.Server{
		Runtime:  apiserver.New(pool, log),
		TenantID: cfg.TenantID,
		Queries:  dbsqlc.New(pool),
		SessionDurations: apiserver.SessionDurations{
			Default: cfg.AdminAPIServer.SessionTTL,
		},
		CredentialKey: adminauthn.DeriveCredentialKey(
			cfg.TenantID, credentialSecret,
		),
	}
	mux := http.NewServeMux()
	routes.RegisterAdminRoutes(mux, s)

	return service.ListenAndServe(
		ctx, log, address, middleware.RequestLogger(s.Runtime)(mux),
	)
}
