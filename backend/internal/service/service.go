// Package service provides the process lifecycle every backend executable
// shares: the healthcheck subcommand, the JSON process logger, signal
// handling, and graceful HTTP shutdown. Each cmd/ package supplies only what
// differs, which is its dependency wiring and its routes.
package service

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
)

// readHeaderTimeout bounds how long a client may take to send its request
// headers, which is what a slow-header attack stretches out.
const readHeaderTimeout = 5 * time.Second

// shutdownTimeout bounds how long a graceful shutdown waits for in-flight
// requests before the process exits anyway.
const shutdownTimeout = 15 * time.Second

// Main is the body of an HTTP service's main(). It resolves the listen
// address, answers the "healthcheck" subcommand the container image's
// HEALTHCHECK invokes, installs the process logger, and reports a failed run.
func Main(component string, run func(*slog.Logger, string) error) {
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
	log := Logger(component)
	if err := run(log, address); err != nil {
		exit(log, err)
	}
}

// MainWithoutServer is Main for a process that serves no HTTP and therefore
// has no listen address or healthcheck subcommand.
func MainWithoutServer(component string, run func(*slog.Logger) error) {
	log := Logger(component)
	if err := run(log); err != nil {
		exit(log, err)
	}
}

// Logger builds the process logger and installs it as the slog default.
func Logger(component string) *slog.Logger {
	handler := slog.NewJSONHandler(
		os.Stdout, &slog.HandlerOptions{AddSource: true},
	)
	log := slog.New(handler).With("component", component)
	slog.SetDefault(log)
	return log
}

// WithTenant binds the tenant to every subsequent log record, including those
// written through the slog default.
func WithTenant(log *slog.Logger, tenantID string) *slog.Logger {
	log = log.With("tenant", tenantID)
	slog.SetDefault(log)
	return log
}

// SignalContext is cancelled when the container runtime asks the process to
// stop.
func SignalContext() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(
		context.Background(), os.Interrupt, syscall.SIGTERM,
	)
}

// ListenAndServe serves handler until it fails or ctx is cancelled, then
// drains in-flight requests.
func ListenAndServe(
	ctx context.Context, log *slog.Logger,
	address string, handler http.Handler,
) error {
	httpServer := &http.Server{
		Addr:              address,
		Handler:           handler,
		ReadHeaderTimeout: readHeaderTimeout,
	}
	failed := make(chan error, 1)
	go func() {
		log.Info("server started", "address", httpServer.Addr)
		err := httpServer.ListenAndServe()
		if errors.Is(err, http.ErrServerClosed) {
			log.Info(
				"HTTP server closed", "event", "server_closed", "error", err,
			)
			err = nil
		}
		failed <- err
	}()

	select {
	case err := <-failed:
		return err
	case <-ctx.Done():
		log.Info("shutdown requested", "event", "shutdown", "error", ctx.Err())
	}

	// A fresh context: the one that triggered the shutdown is already done.
	shutdownCtx, cancel := context.WithTimeout(
		context.Background(), shutdownTimeout,
	)
	defer cancel()
	return httpServer.Shutdown(shutdownCtx)
}

func exit(log *slog.Logger, err error) {
	log.Error(
		"process exited with error", "event", "process_exit", "error", err,
	)
	os.Exit(1)
}
