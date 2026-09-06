package main

import (
	"log/slog"
	"net/http"

	"backend/internal/apiserver"
	"backend/internal/appconfig"
	"backend/internal/db"
	"backend/internal/meshapi"
	"backend/internal/middleware"
	"backend/internal/regions"
	"backend/internal/regionsclient"
	"backend/internal/routes"
	"backend/internal/service"
)

func main() {
	service.Main("mesh-api", run)
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
	catalog, err := regions.Load(cfg.SignupRegionsFile)
	if err != nil {
		return err
	}
	// The inbound credential is this tenant's mesh secret; the outbound one is
	// the coordinator secret. Only mesh-api holds both.
	credential, err := cfg.MeshAPIServer.Credential()
	if err != nil {
		return err
	}
	coordinatorCredential, err := cfg.GlobalCoordinator.Credential()
	if err != nil {
		return err
	}
	directory := regionsclient.New(
		cfg.GlobalCoordinator.BaseURL, regionsclient.CoordinatorPath,
		coordinatorCredential, cfg.GlobalCoordinator.RequestTimeout,
	)
	log = service.WithTenant(log, cfg.TenantID)

	ctx, stop := service.SignalContext()
	defer stop()

	pool, err := db.Connect(ctx, databaseURL, log)
	if err != nil {
		return err
	}
	defer pool.Close()

	s := &meshapi.Server{
		Runtime:         apiserver.New(pool, log),
		TenantID:        cfg.TenantID,
		Regions:         catalog,
		RegionDirectory: directory,
		Credential:      credential,
	}
	mux := http.NewServeMux()
	routes.RegisterMeshRoutes(mux, s)

	return service.ListenAndServe(
		ctx, log, address, middleware.RequestLogger(s.Runtime)(mux),
	)
}
