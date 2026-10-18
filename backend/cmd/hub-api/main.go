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
	"backend/internal/federation/commandkinds"
	"backend/internal/federation/commands"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/hub/emailchange"
	"backend/internal/hub/signupcompletion"
	"backend/internal/identitydigest"
	"backend/internal/middleware"
	"backend/internal/objectstorage"
	"backend/internal/profileclient"
	"backend/internal/publicopeningclient"
	"backend/internal/publicopenings"
	"backend/internal/regions"
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
	digestSecret, err := appconfig.IdentityDigestSecret()
	if err != nil {
		return err
	}
	digestKey := identitydigest.NewKey(digestSecret)
	catalog, err := regions.Load(cfg.SignupRegionsFile)
	if err != nil {
		return err
	}
	// The catalog, mirrored in the portals' region table, decides which
	// regions are offered; this setting decides whether signup is actually
	// served. Disagreement would send visitors to a region that then refuses
	// them, so refuse to start instead.
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
	globalDirectory := directoryclient.New(
		cfg.MeshAPIServer.BaseURL, directoryclient.MeshPrefix,
		meshCredential, cfg.MeshAPIServer.RequestTimeout,
	)
	profiles := profileclient.NewRelay(
		cfg.MeshAPIServer.BaseURL, meshCredential,
		cfg.MeshAPIServer.RequestTimeout,
	)
	openings := publicopeningclient.NewRelay(
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

	hubCredentialKey := hubauthn.DeriveCredentialKey(cfg.TenantID, credentialSecret)
	signupCompletion := signupcompletion.New(
		pool, globalDirectory, cfg.TenantID,
		hubauthn.DeriveCredentialSubkey(hubCredentialKey, "signup-provisioning"),
		digestKey, log, nil,
	)
	emailChange := emailchange.New(
		pool, globalDirectory, cfg.TenantID,
		hubauthn.DeriveCredentialSubkey(hubCredentialKey, "email-change-code"),
		hubauthn.DeriveCredentialSubkey(hubCredentialKey, "outbox"),
		digestKey, log, nil,
	)
	federationCommands := commands.NewSender(commands.SenderConfig{
		Pool: pool, TenantID: cfg.TenantID, Source: "hub-api",
		Executor: commands.NewExecutor(commands.ExecutorConfig{
			Pool: pool, TenantID: cfg.TenantID,
			Registry: commandkinds.Registry(),
		}),
		Relay: commands.NewRelay(
			cfg.MeshAPIServer.BaseURL, meshCredential,
			cfg.MeshAPIServer.RequestTimeout,
		),
		ResultKeys: map[commands.OwnerType][32]byte{
			commands.OwnerHubUser: hubauthn.DeriveCredentialSubkey(
				hubCredentialKey, commands.ResultKeyPurpose,
			),
		},
		Log: log,
	})
	s := &hubruntime.Server{
		Runtime:   apiserver.New(pool, log),
		Queries:   dbsqlc.New(pool),
		Directory: globalDirectory,
		Profiles:  profiles,
		Openings:  openings,
		PublicOpenings: publicopenings.Reader{
			Queries: dbsqlc.New(pool), Logos: pictures,
		},
		Pictures:         pictures,
		SignupCompletion: signupCompletion,
		EmailChange:      emailChange,
		Commands:         federationCommands,
		DigestKey:        digestKey,
		Regions:          catalog,
		Signup:           cfg.HubAPIServer.Signup,
		TenantID:         cfg.TenantID,
		SessionDurations: apiserver.SessionDurations{
			Default:    cfg.HubAPIServer.SessionTTL,
			Remembered: cfg.HubAPIServer.RememberedSessionTTL,
		},
		PublicBaseURL: cfg.HubAPIServer.PublicBaseURL,
		CredentialKey: hubCredentialKey,
		OfferedPlans:  cfg.HubAPIServer.OfferedPlans,
	}
	mux := http.NewServeMux()
	routes.RegisterHubRoutes(mux, s)

	return service.ListenAndServe(
		ctx, log, address, middleware.RequestLogger(s.Runtime)(mux),
	)
}
