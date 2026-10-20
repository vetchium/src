package main

import (
	"fmt"
	"log/slog"
	"net/http"

	"backend/internal/apiserver"
	"backend/internal/appconfig"
	"backend/internal/chatmodel"
	"backend/internal/db"
	dbsqlc "backend/internal/db/sqlc"
	"backend/internal/directoryclient"
	"backend/internal/dnsverify"
	"backend/internal/federation/commandkinds"
	"backend/internal/federation/commands"
	"backend/internal/listingclient"
	"backend/internal/middleware"
	"backend/internal/objectstorage"
	"backend/internal/oidc"
	orgsruntime "backend/internal/orgs"
	orgai "backend/internal/orgs/ai"
	orgsauthn "backend/internal/orgs/auth"
	"backend/internal/orgs/domainverification"
	"backend/internal/orgs/listingread"
	"backend/internal/orgs/listingsearch"
	"backend/internal/orgs/signupcompletion"
	"backend/internal/orgs/workfanout"
	"backend/internal/profileclient"
	"backend/internal/regions"
	"backend/internal/routes"
	"backend/internal/service"
	"backend/internal/workclient"
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
	// The portals' region table offers what the catalog says; this setting
	// decides whether Org signup is served. Refuse to start when they
	// disagree.
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
	listings := listingclient.NewRelay(
		cfg.MeshAPIServer.BaseURL, meshCredential,
		cfg.MeshAPIServer.RequestTimeout,
	)
	workRelay := workclient.NewRelay(
		cfg.MeshAPIServer.BaseURL, meshCredential,
		cfg.MeshAPIServer.RequestTimeout,
	)
	profiles := profileclient.NewRelay(
		cfg.MeshAPIServer.BaseURL, meshCredential,
		cfg.MeshAPIServer.RequestTimeout,
	)
	verification := cfg.OrgDomainVerification
	checker := dnsverify.New(
		verification.ResolverAddress, verification.LookupTimeout,
	)
	if verification.TrustReservedDomains {
		checker.TrustReservedTLDs()
	}
	log = service.WithTenant(log, cfg.TenantID)

	ctx, stop := service.SignalContext()
	defer stop()

	pool, err := db.Connect(ctx, databaseURL, log)
	if err != nil {
		return err
	}
	defer pool.Close()

	accessKey, secretKey, err := cfg.ObjectStorage.Credentials()
	if err != nil {
		return err
	}
	logos, err := objectstorage.New(
		cfg.ObjectStorage.PrivateBaseURL, cfg.ObjectStorage.MediaBaseURL,
		accessKey, secretKey,
	)
	if err != nil {
		return err
	}
	if err := logos.EnsureBucket(ctx); err != nil {
		return err
	}

	credentialKey := orgsauthn.DeriveCredentialKey(
		cfg.TenantID, credentialSecret,
	)
	queries := dbsqlc.New(pool)
	federationCommands := commands.NewSender(commands.SenderConfig{
		Pool: pool, TenantID: cfg.TenantID, Source: "orgs-api",
		Executor: commands.NewExecutor(commands.ExecutorConfig{
			Pool: pool, TenantID: cfg.TenantID,
			Registry: commandkinds.Registry(),
		}),
		Relay: commands.NewRelay(
			cfg.MeshAPIServer.BaseURL, meshCredential,
			cfg.MeshAPIServer.RequestTimeout,
		),
		ResultKeys: map[commands.OwnerType][32]byte{
			commands.OwnerOrgUser: orgsauthn.DeriveCredentialSubkey(
				credentialKey, commands.ResultKeyPurpose,
			),
		},
		Log: log,
	})
	s := &orgsruntime.Server{
		Runtime:   apiserver.New(pool, log),
		Queries:   queries,
		Directory: globalDirectory,
		Regions:   catalog,
		SignupCompletion: signupcompletion.New(
			pool, globalDirectory, checker, cfg.TenantID,
			cfg.OrgsAPIServer.AllowSpecialUseDomains,
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
		Commands: federationCommands,
		ListingRead: listingread.Reader{
			Listings: listings, Directory: globalDirectory, Orgs: queries,
			TenantID: cfg.TenantID, Log: log,
		},
		ListingSearch: listingsearch.Searcher{
			Peers: listings, Tenants: catalog.TenantIDs(),
			Deadline: cfg.MeshAPIServer.RequestTimeout,
		},
		ListingDeadline: cfg.MeshAPIServer.RequestTimeout,
		WorkRelay:       workRelay,
		Profiles:        profiles,
		WorkFanout: workfanout.Fanout{
			Peers: workRelay, Tenants: catalog.TenantIDs(),
			Deadline: cfg.MeshAPIServer.RequestTimeout,
		},
		Signup:                 cfg.OrgsAPIServer.Signup,
		AllowSpecialUseDomains: cfg.OrgsAPIServer.AllowSpecialUseDomains,
		TenantID:               cfg.TenantID,
		SessionTTL:             cfg.OrgsAPIServer.SessionTTL,
		SignupTTL:              cfg.OrgsAPIServer.SignupTTL,
		InvitationTTL:          cfg.OrgsAPIServer.InvitationTTL,
		PublicBaseURL:          cfg.OrgsAPIServer.PublicBaseURL,
		CredentialKey:          credentialKey,
		OfferedPlans:           cfg.OrgBilling.OfferedPlans,
		Logos:                  logos,
		OfferLetters:           logos,
	}
	if google := cfg.OrgsAPIServer.GoogleSignIn; google != nil {
		clientSecret, err := google.ClientSecret()
		if err != nil {
			return err
		}
		s.GoogleSignIn = oidc.New(oidc.Config{
			Issuer: google.Issuer, DiscoveryURL: google.DiscoveryURL,
			ClientID: google.ClientID, ClientSecret: clientSecret,
			RedirectURI: google.RedirectURI,
		})
	}
	if cfg.AI != nil {
		s.AI, err = orgai.NewRuntime(*cfg.AI, chatmodel.New())
		if err != nil {
			return err
		}
	}
	mux := http.NewServeMux()
	routes.RegisterOrgsRoutes(mux, s)

	return service.ListenAndServe(
		ctx, log, address, middleware.RequestLogger(s.Runtime)(mux),
	)
}
