package adminapi

import (
	"log/slog"
	"time"

	"backend/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Server contains the dependencies owned by the admin API process.
type Server struct {
	TenantID        string
	DB              *pgxpool.Pool
	Queries         sqlc.Querier
	AdminSessionTTL time.Duration
	Log             *slog.Logger
}
