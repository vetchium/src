package meshapi

import (
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Server contains the dependencies owned by the mesh API process.
type Server struct {
	TenantID string
	DB       *pgxpool.Pool
	Log      *slog.Logger
}
