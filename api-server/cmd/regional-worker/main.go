package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"
	"vetchium-api-server.gomodule/internal/bgjobs"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/email"
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

	region := os.Getenv("REGION")
	if region == "" {
		logger.Error("REGION environment variable is required")
		os.Exit(1)
	}

	logger.Info("starting regional-worker", "log_level", logLevel.String(), "region", region)

	ctx := context.Background()

	// Connect to regional database (only this region's DB)
	regionalConn, err := pgxpool.New(ctx, os.Getenv("REGIONAL_DB_CONN"))
	if err != nil {
		logger.Error("failed to connect to regional DB", "error", err)
		os.Exit(1)
	}
	defer regionalConn.Close()
	logger.Info("connected to regional database", "region", region)

	regionalQueries := regionaldb.New(regionalConn)

	// Setup graceful shutdown context
	ctx, cancel := signal.NotifyContext(context.Background(),
		syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	// Start email worker
	smtpConfig := email.SMTPConfigFromEnv()
	workerConfig := email.WorkerConfigFromEnv()
	emailSender := email.NewSender(smtpConfig)
	emailDB := &email.RegionalEmailDB{Q: regionalQueries}
	emailWorker := email.NewWorker(emailDB, emailSender, workerConfig, logger, region)
	go emailWorker.Run(ctx)

	// Start regional background jobs worker (cleanup expired tokens, sessions, domain verification)
	environment := os.Getenv("ENVIRONMENT")
	if environment == "" {
		environment = "PROD"
	}
	regionalConfig := bgjobs.RegionalConfigFromEnv()
	regionalWorker := bgjobs.NewRegionalWorker(regionalQueries, regionalConfig, logger, region, environment)
	go regionalWorker.Run(ctx)

	logger.Info("regional-worker started, email and cleanup workers running", "region", region)

	// Wait for shutdown signal
	<-ctx.Done()
	logger.Info("shutting down regional-worker", "region", region)

	logger.Info("regional-worker stopped", "region", region)
}
