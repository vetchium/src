package mcpserver

import (
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Server contains the dependencies owned by the MCP server process.
type Server struct {
	TenantID string
	DB       *pgxpool.Pool
	Log      *slog.Logger
}
