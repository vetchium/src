package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"vetchium-api-server.gomodule/internal/bgjobs"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/email"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/routes"
	"vetchium-api-server.gomodule/internal/server"
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
	logger.Info("starting global-service", "log_level", logLevel.String())

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

	// Load token config (only admin-relevant fields used)
	tokenConfig := bgjobs.TokenConfigFromEnv()

	environment := os.Getenv("ENV")
	if environment == "" {
		environment = "PROD"
	}

	// Load UI configuration (only AdminURL used by global service)
	uiConfig := &server.UIConfig{
		AdminURL: getEnvOrDefault("ADMIN_UI_URL", "http://localhost:3001"),
	}

	s := &server.GlobalServer{
		Global:      globalQueries,
		GlobalPool:  globalConn,
		Log:         logger,
		TokenConfig: tokenConfig,
		UIConfig:    uiConfig,
		Environment: environment,
	}

	// Setup graceful shutdown context
	ctx, cancel := signal.NotifyContext(context.Background(),
		syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	// Start global background cleanup jobs
	globalConfig := bgjobs.GlobalConfigFromEnv()
	globalWorker := bgjobs.NewGlobalWorker(globalQueries, globalConfig, logger)
	go globalWorker.Run(ctx)

	// Start global email worker (processes admin emails from global DB)
	smtpConfig := email.SMTPConfigFromEnv()
	workerConfig := email.WorkerConfigFromEnv()
	emailSender := email.NewSender(smtpConfig)
	emailDB := &email.GlobalEmailDB{Q: globalQueries}
	emailWorker := email.NewWorker(emailDB, emailSender, workerConfig, logger, "global")
	go emailWorker.Run(ctx)

	// Setup HTTP routes for admin handlers
	mux := http.NewServeMux()
	routes.RegisterAdminGlobalRoutes(mux, s)

	// Wrap mux with middleware (CORS must be outermost to handle preflight)
	handler := middleware.CORS()(middleware.RequestID(logger)(mux))

	// Create HTTP server
	httpServer := &http.Server{
		Addr:    ":8081",
		Handler: handler,
	}

	// Start HTTP server in goroutine
	go func() {
		logger.Info("global-service HTTP starting", "port", 8081)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	logger.Info("global-service started, admin HTTP + cleanup + email workers running")

	// Wait for shutdown signal
	<-ctx.Done()
	logger.Info("shutting down global-service")

	// Graceful shutdown with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("server shutdown error", "error", err)
	}

	logger.Info("global-service stopped")
}

func getEnvOrDefault(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
