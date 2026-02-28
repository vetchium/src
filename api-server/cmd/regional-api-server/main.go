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

	// Connect to this server's regional database
	regionalConn, err := pgxpool.New(ctx, os.Getenv("REGIONAL_DB_CONN"))
	if err != nil {
		logger.Error("failed to connect to regional DB", "error", err)
		os.Exit(1)
	}
	defer regionalConn.Close()
	logger.Info("connected to regional database", "region", region)

	// Load token config (for handlers like request_signup)
	tokenConfig := bgjobs.TokenConfigFromEnv()

	currentRegion := globaldb.Region(region)
	environment := os.Getenv("ENV")
	if environment == "" {
		environment = "PROD"
	}

	// Load UI configuration
	uiConfig := &server.UIConfig{
		HubURL:    getEnvOrDefault("HUB_UI_URL", "http://localhost:3000"),
		AdminURL:  getEnvOrDefault("ADMIN_UI_URL", "http://localhost:3001"),
		OrgURL:    getEnvOrDefault("ORG_UI_URL", "http://localhost:3002"),
		AgencyURL: getEnvOrDefault("AGENCY_UI_URL", "http://localhost:3003"),
	}

	// Build internal endpoints map for cross-region proxy
	internalEndpoints := map[globaldb.Region]string{
		globaldb.RegionInd1: getEnvOrDefault("INTERNAL_ENDPOINT_IND1", "http://regional-api-server-ind1:8080"),
		globaldb.RegionUsa1: getEnvOrDefault("INTERNAL_ENDPOINT_USA1", "http://regional-api-server-usa1:8080"),
		globaldb.RegionDeu1: getEnvOrDefault("INTERNAL_ENDPOINT_DEU1", "http://regional-api-server-deu1:8080"),
	}

	storageConfig := &server.StorageConfig{
		Endpoint:        os.Getenv("S3_ENDPOINT"),
		AccessKeyID:     os.Getenv("S3_ACCESS_KEY_ID"),
		SecretAccessKey: os.Getenv("S3_SECRET_ACCESS_KEY"),
		Region:          getEnvOrDefault("S3_REGION", "us-east-1"),
		Bucket:          os.Getenv("S3_BUCKET"),
	}

	s := &server.Server{
		Global:            globaldb.New(globalConn),
		GlobalPool:        globalConn,
		Regional:          regionaldb.New(regionalConn),
		RegionalPool:      regionalConn,
		Log:               logger,
		CurrentRegion:     currentRegion,
		TokenConfig:       tokenConfig,
		UIConfig:          uiConfig,
		Environment:       environment,
		InternalEndpoints: internalEndpoints,
		StorageConfig:     storageConfig,
	}

	// Setup graceful shutdown context
	ctx, cancel := signal.NotifyContext(context.Background(),
		syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	// NOTE: Email worker and regional background jobs are now handled
	// by the separate regional-worker binary. This binary only serves HTTP.

	mux := http.NewServeMux()

	// Register routes from separate files
	routes.RegisterGlobalRoutes(mux, s)
	routes.RegisterHubRoutes(mux, s)
	routes.RegisterEmployerRoutes(mux, s)
	routes.RegisterAgencyRoutes(mux, s)

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

func getEnvOrDefault(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
