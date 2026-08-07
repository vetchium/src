package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"backend/internal/apiserver"
	"backend/internal/db"
	"backend/internal/middleware"
	"backend/internal/orgsapi"
	"backend/internal/routes"
)

const address = ":8080"

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("component", "orgs-api")
	slog.SetDefault(log)

	if err := run(log); err != nil {
		log.Error("process exited with error", "error", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := orgsapi.LoadConfig()
	if err != nil {
		return err
	}
	log = log.With("tenant", cfg.TenantID)
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL, log)
	if err != nil {
		return err
	}
	defer pool.Close()

	s := &orgsapi.Server{Runtime: apiserver.New(pool, log), TenantID: cfg.TenantID}
	mux := http.NewServeMux()
	routes.RegisterOrgsRoutes(mux, s)

	httpServer := &http.Server{
		Addr:              address,
		Handler:           middleware.RequestLogger(s.Runtime)(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}
	errC := make(chan error, 1)
	go func() {
		log.Info("server started", "address", httpServer.Addr)
		err := httpServer.ListenAndServe()
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		errC <- err
	}()

	select {
	case err := <-errC:
		return err
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdownCtx)
}
