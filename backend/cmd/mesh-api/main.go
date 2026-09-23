package main

import (
	"log/slog"
	"net/http"

	"backend/internal/apiserver"
	"backend/internal/appconfig"
	"backend/internal/db"
	"backend/internal/db/sqlc"
	"backend/internal/directoryclient"
	"backend/internal/meshapi"
	"backend/internal/meshtls"
	"backend/internal/middleware"
	"backend/internal/objectstorage"
	"backend/internal/profileclient"
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
	regionDirectory := regionsclient.NewMutualTLS(
		cfg.GlobalCoordinator.BaseURL, regionsclient.CoordinatorPath,
		"", cfg.GlobalCoordinator.RequestTimeout,
		coordinatorTLS,
	)
	directory := directoryclient.NewMutualTLS(
		cfg.GlobalCoordinator.BaseURL, directoryclient.CoordinatorPrefix,
		cfg.GlobalCoordinator.RequestTimeout, coordinatorTLS,
	)
	profiles := profileclient.NewPeer(
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
		Runtime:         apiserver.New(pool, log),
		TenantID:        cfg.TenantID,
		Regions:         catalog,
		RegionDirectory: regionDirectory,
		Directory:       directory,
		Profiles:        profiles,
		Pictures:        pictures,
		Queries:         sqlc.New(pool),
		Credential:      credential,
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
