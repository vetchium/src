package main

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"backend/internal/apiserver"
	"backend/internal/db"
	"backend/internal/globalcoordinator"
	"backend/internal/globaldirectory"
	"backend/internal/meshtls"
	"backend/internal/middleware"
	"backend/internal/regions"
	"backend/internal/routes"
	"backend/internal/service"
)

func main() {
	service.MainWithHealthCheck(
		"global-coordinator", run, globalCoordinatorHealthCheck,
	)
}

func globalCoordinatorHealthCheck(address string) error {
	config, err := globalcoordinator.LoadConfig()
	if err != nil {
		return err
	}
	tlsConfig, err := meshtls.ClientConfig(
		config.TLS.HealthCertificateFile, config.TLS.HealthKeyFile,
		config.TLS.ClientCAFile, config.TLS.HealthServerName,
	)
	if err != nil {
		return err
	}
	return apiserver.SelfCheckTLS(address, tlsConfig)
}

func run(log *slog.Logger, address string) error {
	config, err := globalcoordinator.LoadConfig()
	if err != nil {
		return err
	}
	catalog, err := regions.Load(config.SignupRegionsFile)
	if err != nil {
		return err
	}
	databaseURL, err := config.Database.URL()
	if err != nil {
		return err
	}
	tlsConfig, err := meshtls.ServerConfig(
		config.TLS.CertificateFile, config.TLS.KeyFile,
		config.TLS.ClientCAFile,
	)
	if err != nil {
		return err
	}
	ctx, stop := service.SignalContext()
	defer stop()

	pool, err := db.Connect(ctx, databaseURL, log)
	if err != nil {
		return err
	}
	defer pool.Close()

	runtime := apiserver.New(pool, log)
	directory := globaldirectory.New(pool, config.IdentityDigestKeyID)
	server := &globalcoordinator.Server{
		Runtime:   runtime,
		Regions:   catalog,
		Directory: directory,
	}
	mux := http.NewServeMux()
	routes.RegisterGlobalCoordinatorRoutes(mux, server)
	go reapExpiredReservations(ctx, log, directory)
	go pruneTerminalEmailChangeReservations(ctx, log, directory)

	return service.ListenAndServeTLS(
		ctx, log, address,
		middleware.RequestLogger(runtime)(middleware.MeshIdentity(mux)),
		tlsConfig,
	)
}

func reapExpiredReservations(
	ctx context.Context, log *slog.Logger,
	directory *globaldirectory.Service,
) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		count, err := directory.ReapExpiredReservations(ctx)
		if err != nil && ctx.Err() == nil {
			log.Error(
				"failed to reap expired directory reservations",
				"event", "directory_reservation_reap_failed", "error", err,
			)
		} else if count > 0 {
			log.Info(
				"expired directory reservations reaped",
				"event", "directory_reservations_reaped", "count", count,
			)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// pruneTerminalEmailChangeReservations implements the second half of
// GU-DIR-010. It runs far less often than the reaper above because
// terminal reservations are only pruned a full week after they stop being
// able to fence anything.
func pruneTerminalEmailChangeReservations(
	ctx context.Context, log *slog.Logger,
	directory *globaldirectory.Service,
) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		count, err := directory.PruneTerminalHubAccountEmailChangeReservations(ctx)
		if err != nil && ctx.Err() == nil {
			log.Error(
				"failed to prune terminal email change reservations",
				"event", "email_change_reservation_prune_failed", "error", err,
			)
		} else if count > 0 {
			log.Info(
				"terminal email change reservations pruned",
				"event", "email_change_reservations_pruned", "count", count,
			)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
