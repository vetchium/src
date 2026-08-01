package routes

import (
	"fmt"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"backend/handlers/health"
	"backend/internal/server"
	"backend/internal/version"
	"backend/tools"
)

func RegisterMCPRoutes(mux *http.ServeMux, s *server.Server) {
	log := s.Log.With("subsystem", "mcp")
	mcpServer := mcp.NewServer(
		&mcp.Implementation{
			Name:    "vetchium-" + s.TenantID,
			Title:   fmt.Sprintf("Vetchium (%s)", s.TenantID),
			Version: version.Value,
		},
		&mcp.ServerOptions{
			Instructions: fmt.Sprintf("Read-only access to the %q tenant.", s.TenantID),
			Logger:       log,
		},
	)
	tools.Register(mcpServer, s)

	transport := mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return mcpServer },
		&mcp.StreamableHTTPOptions{Stateless: true, Logger: log},
	)
	mux.Handle("/mcp", transport)
	mux.HandleFunc("GET /readyz", health.Ready(s))
}
