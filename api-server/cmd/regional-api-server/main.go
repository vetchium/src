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
	"vetchium-api-server.gomodule/internal/db/regionaldb"
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
	logger.Info("starting server", "log_level", logLevel.String())

	region := os.Getenv("REGION")
	if region == "" {
		region = "unknown"
	}

	ctx := context.Background()

	// Connect to global database
	globalConn, err := pgxpool.New(ctx, os.Getenv("GLOBAL_DB_CONN"))
	if err != nil {
		logger.Error("failed to connect to global DB", "error", err)
		os.Exit(1)
	}
	defer globalConn.Close()
	logger.Info("connected to global database")

	// Connect to regional databases
	regionalIND1, err := pgxpool.New(ctx, os.Getenv("REGIONAL_DB_IND1_CONN"))
	if err != nil {
		logger.Error("failed to connect to regional DB IND1", "error", err)
		os.Exit(1)
	}
	defer regionalIND1.Close()
	logger.Info("connected to regional database IND1")

	regionalUSA1, err := pgxpool.New(ctx, os.Getenv("REGIONAL_DB_USA1_CONN"))
	if err != nil {
		logger.Error("failed to connect to regional DB USA1", "error", err)
		os.Exit(1)
	}
	defer regionalUSA1.Close()
	logger.Info("connected to regional database USA1")

	regionalDEU1, err := pgxpool.New(ctx, os.Getenv("REGIONAL_DB_DEU1_CONN"))
	if err != nil {
		logger.Error("failed to connect to regional DB DEU1", "error", err)
		os.Exit(1)
	}
	defer regionalDEU1.Close()
	logger.Info("connected to regional database DEU1")

	// Load SMTP config
	smtpConfig := email.SMTPConfigFromEnv()

	// Load token config (for handlers like request_signup)
	tokenConfig := bgjobs.TokenConfigFromEnv()

	currentRegion := globaldb.Region(region)

	s := &server.Server{
		Global:        globaldb.New(globalConn),
		RegionalIND1:  regionaldb.New(regionalIND1),
		RegionalUSA1:  regionaldb.New(regionalUSA1),
		RegionalDEU1:  regionaldb.New(regionalDEU1),
		Log:           logger,
		SMTPConfig:    smtpConfig,
		CurrentRegion: currentRegion,
		TokenConfig:   tokenConfig,
	}

	// Setup graceful shutdown context
	ctx, cancel := signal.NotifyContext(context.Background(),
		syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	// Start email worker for this region
	regionalQueries := s.GetRegionalDB(currentRegion)
	if regionalQueries != nil {
		workerConfig := email.WorkerConfigFromEnv()
		emailSender := email.NewSender(smtpConfig)
		worker := email.NewWorker(regionalQueries, emailSender, workerConfig, logger, region)
		go worker.Run(ctx)

		// Start regional background jobs worker (per-region, like email worker)
		regionalConfig := bgjobs.RegionalConfigFromEnv()
		regionalWorker := bgjobs.NewRegionalWorker(regionalQueries, regionalConfig, logger, region)
		go regionalWorker.Run(ctx)
	} else {
		logger.Warn("unknown region, email and bgjobs workers will not start", "region", region)
	}

	mux := http.NewServeMux()

	// Register routes from separate files
	routes.RegisterGlobalRoutes(mux, s)
	routes.RegisterHubRoutes(mux, s)
	routes.RegisterAdminRoutes(mux, s)
	routes.RegisterOrgRoutes(mux, s)

	// Wrap mux with middleware (CORS must be outermost to handle preflight)
	handler := middleware.CORS()(middleware.RequestID(logger)(mux))

	// Create HTTP server for graceful shutdown
	httpServer := &http.Server{
		Addr:    ":8080",
		Handler: handler,
	}

	// Start HTTP server in goroutine
	go func() {
		logger.Info("server starting", "port", 8080, "region", region)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for shutdown signal
	<-ctx.Done()
	logger.Info("shutting down server")

	// Graceful shutdown with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("server shutdown error", "error", err)
	}

	logger.Info("server stopped")
}
