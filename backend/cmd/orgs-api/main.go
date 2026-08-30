package main

import (
	"log/slog"
	"net/http"

	"backend/internal/apiserver"
	"backend/internal/appconfig"
	"backend/internal/db"
	dbsqlc "backend/internal/db/sqlc"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
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
	log = service.WithTenant(log, cfg.TenantID)

	ctx, stop := service.SignalContext()
	defer stop()

	pool, err := db.Connect(ctx, databaseURL, log)
	if err != nil {
		return err
	}
	defer pool.Close()

	s := &orgsruntime.Server{
		Runtime:  apiserver.New(pool, log),
		Queries:  dbsqlc.New(pool),
		TenantID: cfg.TenantID,
	}
	mux := http.NewServeMux()
	routes.RegisterOrgsRoutes(mux, s)

	return service.ListenAndServe(
		ctx, log, address, middleware.RequestLogger(s.Runtime)(mux),
	)
}
