package routes

import (
	"fmt"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"backend/internal/apiserver"
	"backend/internal/mcpserver"
	"backend/internal/version"
	"backend/tools"
)

func RegisterMCPRoutes(mux *http.ServeMux, s *mcpserver.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)

	log := s.With("subsystem", "mcp")
	instructions := fmt.Sprintf(
		"Read-only access to the %q tenant.", s.TenantID,
	)
	mcpServer := mcp.NewServer(
		&mcp.Implementation{
			Name:    "vetchium-" + s.TenantID,
			Title:   fmt.Sprintf("Vetchium (%s)", s.TenantID),
			Version: version.Value,
		},
		&mcp.ServerOptions{
			Instructions: instructions,
			Logger:       log,
		},
	)
	tools.Register(mcpServer)

	transport := mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return mcpServer },
		&mcp.StreamableHTTPOptions{Stateless: true, Logger: log},
	)
	mux.Handle("/mcp", transport)
}
