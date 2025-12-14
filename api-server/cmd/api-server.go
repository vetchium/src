package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/handlers/hub"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
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
	globalConn, err := pgx.Connect(ctx, os.Getenv("GLOBAL_DB_CONN"))
	if err != nil {
		logger.Error("failed to connect to global DB", "error", err)
		os.Exit(1)
	}
	defer globalConn.Close(ctx)
	logger.Info("connected to global database")

	// Connect to regional databases
	regionalIND1, err := pgx.Connect(ctx, os.Getenv("REGIONAL_DB_IND1_CONN"))
	if err != nil {
		logger.Error("failed to connect to regional DB IND1", "error", err)
		os.Exit(1)
	}
	defer regionalIND1.Close(ctx)
	logger.Info("connected to regional database IND1")

	regionalUSA1, err := pgx.Connect(ctx, os.Getenv("REGIONAL_DB_USA1_CONN"))
	if err != nil {
		logger.Error("failed to connect to regional DB USA1", "error", err)
		os.Exit(1)
	}
	defer regionalUSA1.Close(ctx)
	logger.Info("connected to regional database USA1")

	regionalDEU1, err := pgx.Connect(ctx, os.Getenv("REGIONAL_DB_DEU1_CONN"))
	if err != nil {
		logger.Error("failed to connect to regional DB DEU1", "error", err)
		os.Exit(1)
	}
	defer regionalDEU1.Close(ctx)
	logger.Info("connected to regional database DEU1")

	s := &server.Server{
		Global:       globaldb.New(globalConn),
		RegionalIND1: regionaldb.New(regionalIND1),
		RegionalUSA1: regionaldb.New(regionalUSA1),
		RegionalDEU1: regionaldb.New(regionalDEU1),
		Log:          logger,
	}

	mux := http.NewServeMux()

	mux.HandleFunc("OPTIONS /hub/login", hub.LoginOptions)
	mux.HandleFunc("POST /hub/login", hub.Login(s))

	// Wrap mux with request ID middleware
	handler := middleware.RequestID(logger)(mux)

	logger.Info("server starting", "port", 8080, "region", region)
	if err := http.ListenAndServe(":8080", handler); err != nil {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}
