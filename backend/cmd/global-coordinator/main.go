package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"backend/internal/apiserver"
	"backend/internal/globalcoordinator"
	"backend/internal/middleware"
	"backend/internal/routes"
)

func main() {
	address, err := apiserver.ListenAddress()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		if err := apiserver.SelfCheck(address); err != nil {
			os.Exit(1)
		}
		return
	}
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{AddSource: true})
	log := slog.New(handler).With("component", "global-coordinator")
	slog.SetDefault(log)
	if err := run(log, address); err != nil {
		log.Error("process exited with error", "event", "process_exit", "error", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger, address string) error {
	config, err := globalcoordinator.LoadConfig()
	if err != nil {
		return err
	}
	credential, err := globalcoordinator.LoadCredential(config.CredentialFile)
	if err != nil {
		return err
	}
	generator, err := globalcoordinator.OpenGenerator(config.StateFile)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := generator.Close(); closeErr != nil {
			log.Error(
				"close short ID generator",
				"event", "generator_close_error",
				"error", closeErr,
			)
		}
	}()

	ctx, stop := signal.NotifyContext(
		context.Background(), os.Interrupt, syscall.SIGTERM,
	)
	defer stop()
	runtime := apiserver.New(nil, log)
	server := &globalcoordinator.Server{
		Runtime:    runtime,
		Generator:  generator,
		Credential: credential,
	}
	mux := http.NewServeMux()
	routes.RegisterGlobalCoordinatorRoutes(mux, server)
	httpServer := &http.Server{
		Addr:              address,
		Handler:           middleware.RequestLogger(runtime)(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}
	errC := make(chan error, 1)
	go func() {
		log.Info("server started", "address", httpServer.Addr)
		serveErr := httpServer.ListenAndServe()
		if errors.Is(serveErr, http.ErrServerClosed) {
			log.Info("HTTP server closed", "event", "server_closed", "error", serveErr)
			serveErr = nil
		}
		errC <- serveErr
	}()
	select {
	case err := <-errC:
		return err
	case <-ctx.Done():
		log.Info("shutdown requested", "event", "shutdown", "error", ctx.Err())
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdownCtx)
}
