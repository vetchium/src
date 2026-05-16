package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
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
		HubURL:   getEnvOrDefault("HUB_UI_URL", "http://localhost:3000"),
		AdminURL: getEnvOrDefault("ADMIN_UI_URL", "http://localhost:3001"),
		OrgURL:   getEnvOrDefault("ORG_UI_URL", "http://localhost:3002"),
	}

	// Build per-region storage configs
	allStorageConfigs := map[globaldb.Region]*server.StorageConfig{}
	for _, rgn := range []globaldb.Region{globaldb.RegionInd1, globaldb.RegionUsa1, globaldb.RegionDeu1} {
		suffix := strings.ToUpper(string(rgn)) // "IND1", "USA1", "DEU1"
		endpoint := os.Getenv("S3_ENDPOINT_" + suffix)
		bucket := os.Getenv("S3_BUCKET_" + suffix)
		if endpoint == "" || bucket == "" {
			logger.Warn("missing S3 config for region", "region", rgn)
			continue
		}
		allStorageConfigs[rgn] = &server.StorageConfig{
			Endpoint:        endpoint,
			AccessKeyID:     os.Getenv("S3_ACCESS_KEY_ID_" + suffix),
			SecretAccessKey: os.Getenv("S3_SECRET_ACCESS_KEY_" + suffix),
			Region:          os.Getenv("S3_REGION_" + suffix),
			Bucket:          bucket,
		}
	}

	// Build global storage config (for admin-managed assets)
	globalStorageConfig := &server.StorageConfig{
		Endpoint:        os.Getenv("GLOBAL_S3_ENDPOINT"),
		AccessKeyID:     os.Getenv("GLOBAL_S3_ACCESS_KEY_ID"),
		SecretAccessKey: os.Getenv("GLOBAL_S3_SECRET_ACCESS_KEY"),
		Region:          os.Getenv("GLOBAL_S3_REGION"),
		Bucket:          os.Getenv("GLOBAL_S3_BUCKET"),
	}

	// Build all-regional-DB and pool maps for cross-region reads and writes
	allRegionalDBs := map[globaldb.Region]*regionaldb.Queries{
		currentRegion: regionaldb.New(regionalConn),
	}
	allRegionalPools := map[globaldb.Region]*pgxpool.Pool{
		currentRegion: regionalConn,
	}
	allRegionalConnEnvs := map[globaldb.Region]string{
		globaldb.RegionInd1: getEnvOrDefault("REGIONAL_DB_CONN_IND1", ""),
		globaldb.RegionUsa1: getEnvOrDefault("REGIONAL_DB_CONN_USA1", ""),
		globaldb.RegionDeu1: getEnvOrDefault("REGIONAL_DB_CONN_DEU1", ""),
	}
	for rgn, connStr := range allRegionalConnEnvs {
		if rgn == currentRegion || connStr == "" {
			continue
		}
		pool, err := pgxpool.New(ctx, connStr)
		if err != nil {
			logger.Warn("failed to connect to remote regional DB", "region", rgn, "error", err)
			continue
		}
		defer pool.Close()
		allRegionalDBs[rgn] = regionaldb.New(pool)
		allRegionalPools[rgn] = pool
	}

	s := &server.RegionalServer{
		BaseServer: server.BaseServer{
			Global:      globaldb.New(globalConn),
			GlobalPool:  globalConn,
			Log:         logger,
			TokenConfig: tokenConfig,
			UIConfig:    uiConfig,
			Environment: environment,
		},
		Regional:            regionaldb.New(regionalConn),
		RegionalPool:        regionalConn,
		AllRegionalDBs:      allRegionalDBs,
		AllRegionalPools:    allRegionalPools,
		AllStorageConfigs:   allStorageConfigs,
		GlobalStorageConfig: globalStorageConfig,
		CurrentRegion:       currentRegion,
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

func getEnvOrDefault(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
