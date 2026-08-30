package main

import (
	"log/slog"
	"net/http"

	"backend/internal/apiserver"
	"backend/internal/appconfig"
	"backend/internal/db"
	dbsqlc "backend/internal/db/sqlc"
	"backend/internal/globalcoordinatorclient"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/middleware"
	"backend/internal/routes"
	"backend/internal/service"
)

func main() {
	service.Main("hub-api", run)
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
	credentialSecret, err := appconfig.HubCredentialSecret()
	if err != nil {
		return err
	}
	coordinator, err := globalcoordinatorclient.NewFromConfig(
		cfg.GlobalCoordinator,
	)
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

	s := &hubruntime.Server{
		Runtime:     apiserver.New(pool, log),
		Queries:     dbsqlc.New(pool),
		Coordinator: coordinator,
		TenantID:    cfg.TenantID,
		SessionDurations: apiserver.SessionDurations{
			Default:    cfg.HubAPIServer.SessionTTL,
			Remembered: cfg.HubAPIServer.RememberedSessionTTL,
		},
		PublicBaseURL: cfg.HubAPIServer.PublicBaseURL,
		CredentialKey: hubauthn.DeriveCredentialKey(
			cfg.TenantID, credentialSecret,
		),
	}
	mux := http.NewServeMux()
	routes.RegisterHubRoutes(mux, s)

	return service.ListenAndServe(
		ctx, log, address, middleware.RequestLogger(s.Runtime)(mux),
	)
}
