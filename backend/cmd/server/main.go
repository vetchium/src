package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"backend/internal/config"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

func main() {
	// Initialize slog
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("Failed to load config", "err", err)
		os.Exit(1)
	}

	slog.Info("Starting server", "env", cfg.Env, "tenant", cfg.TenantID)

	// Connect to database
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("Failed to connect to database", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	// 1. Periodic Tasks
	go runPeriodicTasks(cfg.TenantID)

	// 2. Portal API
	portalMux := http.NewServeMux()
	portalMux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(fmt.Sprintf("Portal API OK - Tenant: %s", cfg.TenantID)))
	})
	portalServer := &http.Server{
		Addr:    ":" + cfg.PortalPort,
		Handler: portalMux,
	}

	go func() {
		slog.Info("Starting portal-api", "port", cfg.PortalPort)
		if err := portalServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("portal-api failed", "err", err)
		}
	}()

	// 3. Mesh API
	meshMux := http.NewServeMux()
	meshMux.HandleFunc("/mesh/sync", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Mesh API OK"))
	})
	meshServer := &http.Server{
		Addr:    ":" + cfg.MeshPort,
		Handler: meshMux,
	}

	// TODO: Secure this mesh-api with Wireguard for inter-instance communication
	go func() {
		slog.Info("Starting mesh-api", "port", cfg.MeshPort)
		if err := meshServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("mesh-api failed", "err", err)
		}
	}()

	// 4. MCP Server
	mcpServer := server.NewMCPServer(
		"backend-mcp",
		"1.0.0",
	)
	mcpServer.AddTool(mcp.NewTool("echo",
		mcp.WithDescription("echo tool"),
		mcp.WithString("message",
			mcp.Required(),
			mcp.Description("message to echo"),
		),
	), func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		msg := request.Params.Arguments["message"].(string)
		return mcp.NewToolResultText(msg), nil
	})

	// Start MCP via stdio
	go func() {
		slog.Info("Starting MCP server over stdio")
		if err := server.ServeStdio(mcpServer); err != nil {
			slog.Error("MCP server failed", "err", err)
		}
	}()

	// Wait for interrupt signal
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	<-c

	slog.Info("Shutting down servers...")
	ctxShutDown, cancelShutDown := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelShutDown()

	portalServer.Shutdown(ctxShutDown)
	meshServer.Shutdown(ctxShutDown)
	slog.Info("Shutdown complete")
}

func runPeriodicTasks(tenant string) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			slog.Info("Running periodic task", "tenant", tenant)
		}
	}
}
