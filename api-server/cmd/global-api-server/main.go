package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"
	"vetchium-api-server.gomodule/internal/bgjobs"
	"vetchium-api-server.gomodule/internal/db/globaldb"
)

func main() {
	// Configure log level from environment (default: INFO)
	logLevel := slog.LevelInfo
	switch os.Getenv("LOG_LEVEL") {
	case "DEBUG", "debug":
		logLevel = slog.LevelDebug
	case "WARN", "warn":
		logLevel = slog.LevelWarn
	case "ERROR", "error":
		logLevel = slog.LevelError
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		AddSource: true,
		Level:     logLevel,
	}))
	logger.Info("starting global-api-server", "log_level", logLevel.String())

	ctx := context.Background()

	// Connect to global database
	globalConn, err := pgxpool.New(ctx, os.Getenv("GLOBAL_DB_CONN"))
	if err != nil {
		logger.Error("failed to connect to global DB", "error", err)
		os.Exit(1)
	}
	defer globalConn.Close()
	logger.Info("connected to global database")

	globalQueries := globaldb.New(globalConn)

	// Setup graceful shutdown context
	ctx, cancel := signal.NotifyContext(context.Background(),
		syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	// Load global background jobs config
	globalConfig := bgjobs.GlobalConfigFromEnv()

	// Start global background jobs worker
	globalWorker := bgjobs.NewGlobalWorker(globalQueries, globalConfig, logger)
	go globalWorker.Run(ctx)

	logger.Info("global-api-server started, background jobs running")

	// Wait for shutdown signal
	<-ctx.Done()
	logger.Info("shutting down global-api-server")

	logger.Info("global-api-server stopped")
}
