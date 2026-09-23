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
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/hub/signupcompletion"
	"backend/internal/middleware"
	"backend/internal/objectstorage"
	"backend/internal/profileclient"
	"backend/internal/regions"
	"backend/internal/regionsclient"
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
	catalog, err := regions.Load(cfg.SignupRegionsFile)
	if err != nil {
		return err
	}
	if !catalog.HasOrigin(cfg.TenantID, cfg.HubAPIServer.PublicBaseURL) {
		return fmt.Errorf("tenant origin missing from signup catalog")
	}
	// The catalog decides which regions discovery offers; this setting decides
	// whether signup is actually served. Disagreement would route visitors to a
	// region that then refuses them, so refuse to start instead.
	if catalog.SignupEnabled(cfg.TenantID) != cfg.HubAPIServer.Signup.Enabled {
		return fmt.Errorf(
			"signup catalog says enabled=%t for %q but hubAPIServer.signup.enabled is %t",
			catalog.SignupEnabled(cfg.TenantID), cfg.TenantID,
			cfg.HubAPIServer.Signup.Enabled,
		)
	}
	meshCredential, err := cfg.MeshAPIServer.Credential()
	if err != nil {
		return err
	}
	directory := regionsclient.New(
		cfg.MeshAPIServer.BaseURL, regionsclient.MeshPath,
		meshCredential, cfg.MeshAPIServer.RequestTimeout,
	)
	globalDirectory := directoryclient.New(
		cfg.MeshAPIServer.BaseURL, directoryclient.MeshPrefix,
		meshCredential, cfg.MeshAPIServer.RequestTimeout,
	)
	profiles := profileclient.NewRelay(
		cfg.MeshAPIServer.BaseURL, meshCredential,
		cfg.MeshAPIServer.RequestTimeout,
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
	log = service.WithTenant(log, cfg.TenantID)

	ctx, stop := service.SignalContext()
	defer stop()

	pool, err := db.Connect(ctx, databaseURL, log)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := pictures.EnsureBucket(ctx); err != nil {
		return err
	}

	signupCompletion := signupcompletion.New(
		pool, globalDirectory, cfg.TenantID,
		hubauthn.DeriveCredentialSubkey(
			hubauthn.DeriveCredentialKey(cfg.TenantID, credentialSecret),
			"signup-provisioning",
		),
		nil,
	)
	s := &hubruntime.Server{
		Runtime:          apiserver.New(pool, log),
		Queries:          dbsqlc.New(pool),
		RegionDirectory:  directory,
		Directory:        globalDirectory,
		Profiles:         profiles,
		Pictures:         pictures,
		SignupCompletion: signupCompletion,
		Regions:          catalog,
		Signup:           cfg.HubAPIServer.Signup,
		TenantID:         cfg.TenantID,
		SessionDurations: apiserver.SessionDurations{
			Default:    cfg.HubAPIServer.SessionTTL,
			Remembered: cfg.HubAPIServer.RememberedSessionTTL,
		},
		PublicBaseURL: cfg.HubAPIServer.PublicBaseURL,
		CredentialKey: hubauthn.DeriveCredentialKey(
			cfg.TenantID, credentialSecret,
		),
		OfferedPlans: cfg.HubAPIServer.OfferedPlans,
	}
	mux := http.NewServeMux()
	routes.RegisterHubRoutes(mux, s)

	return service.ListenAndServe(
		ctx, log, address, middleware.RequestLogger(s.Runtime)(mux),
	)
}
