package main

import (
	"log/slog"
	"net/http"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

	"backend/internal/apiserver"
	"backend/internal/appconfig"
	"backend/internal/conversationclient"
	"backend/internal/db"
	"backend/internal/db/sqlc"
	"backend/internal/directoryclient"
	"backend/internal/federation/commandkinds"
	"backend/internal/federation/commands"
	"backend/internal/federation/eventkinds"
	"backend/internal/federation/events"
	"backend/internal/hubapplicationclient"
	"backend/internal/listingclient"
	"backend/internal/listings"
	"backend/internal/meshapi"
	"backend/internal/meshtls"
	"backend/internal/middleware"
	"backend/internal/objectstorage"
	"backend/internal/orgs/entitlements"
	"backend/internal/profileclient"
	"backend/internal/providerwork"
	"backend/internal/publicopeningclient"
	"backend/internal/publicopenings"
	"backend/internal/routes"
	"backend/internal/service"
	"backend/internal/workclient"
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
	// The inbound credential is this tenant's portal-to-mesh secret. The
	// outbound coordinator connection is authenticated by the tenant client
	// certificate, which only mesh-api receives.
	credential, err := cfg.MeshAPIServer.Credential()
	if err != nil {
		return err
	}
	coordinatorTLS, err := meshtls.ClientConfig(
		cfg.GlobalCoordinator.TLS.CertificateFile,
		cfg.GlobalCoordinator.TLS.KeyFile,
		cfg.GlobalCoordinator.TLS.CAFile,
		cfg.GlobalCoordinator.TLS.ServerName,
	)
	if err != nil {
		return err
	}
	peerTLS, err := meshtls.ServerConfig(
		cfg.MeshAPIServer.PeerTLS.CertificateFile,
		cfg.MeshAPIServer.PeerTLS.KeyFile,
		cfg.MeshAPIServer.PeerTLS.ClientCAFile,
	)
	if err != nil {
		return err
	}
	directory := directoryclient.NewMutualTLS(
		cfg.GlobalCoordinator.BaseURL, directoryclient.CoordinatorPrefix,
		cfg.GlobalCoordinator.RequestTimeout, coordinatorTLS,
	)
	profiles := profileclient.NewPeer(
		coordinatorTLS, cfg.GlobalCoordinator.RequestTimeout,
	)
	openings := publicopeningclient.NewPeer(
		coordinatorTLS, cfg.GlobalCoordinator.RequestTimeout,
	)
	applications := hubapplicationclient.NewPeer(
		coordinatorTLS, cfg.GlobalCoordinator.RequestTimeout,
	)
	listingPeers := listingclient.NewPeer(
		coordinatorTLS, cfg.GlobalCoordinator.RequestTimeout,
	)
	workPeers := workclient.NewPeer(
		coordinatorTLS, cfg.GlobalCoordinator.RequestTimeout,
	)
	conversationPeers := conversationclient.NewPeer(
		coordinatorTLS, cfg.GlobalCoordinator.RequestTimeout,
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

	s := &meshapi.Server{
		Runtime:      apiserver.New(pool, log),
		TenantID:     cfg.TenantID,
		Directory:    directory,
		Profiles:     profiles,
		Openings:     openings,
		Applications: applications,
		PublicOpenings: publicopenings.Reader{
			Queries: sqlc.New(pool), Logos: pictures,
		},
		ListingPeers:      listingPeers,
		WorkPeers:         workPeers,
		ConversationPeers: conversationPeers,
		ProviderWork:      providerwork.Reader{Queries: sqlc.New(pool)},
		PublicListings: listings.Reader{
			Queries: sqlc.New(pool), Logos: pictures,
			ListingPlanOIDs: entitlements.PlanOIDs(subscriptionspec.AllowsListings),
			LogoPlanOIDs:    entitlements.PlanOIDs(subscriptionspec.AllowsLogo),
		},
		Pictures:     pictures,
		OfferLetters: pictures,
		Queries:      sqlc.New(pool),
		Credential:   credential,
		Commands: commands.NewExecutor(commands.ExecutorConfig{
			Pool: pool, TenantID: cfg.TenantID,
			Registry: commandkinds.Registry(), Directory: directory,
		}),
		CommandPeers: commands.NewPeer(
			coordinatorTLS, cfg.GlobalCoordinator.RequestTimeout,
		),
		Events: events.NewReceiver(events.ReceiverConfig{
			Pool: pool, TenantID: cfg.TenantID, Source: "mesh-api",
			Registry: eventkinds.Registry(), Directory: directory,
		}),
		EventPeers: events.NewPeer(
			coordinatorTLS, cfg.GlobalCoordinator.RequestTimeout,
		),
	}
	mux := http.NewServeMux()
	routes.RegisterMeshRoutes(mux, s)
	peerMux := http.NewServeMux()
	routes.RegisterMeshPeerRoutes(peerMux, s)

	return service.ListenAndServeEndpoints(
		ctx, log,
		service.Endpoint{
			Name: "local-relay", Address: address,
			Handler: middleware.RequestLogger(s.Runtime)(mux),
		},
		service.Endpoint{
			Name: "mesh-peer", Address: cfg.MeshAPIServer.PeerAddress,
			Handler: middleware.RequestLogger(s.Runtime)(
				middleware.MeshIdentity(peerMux),
			),
			TLSConfig: peerTLS,
		},
	)
}
