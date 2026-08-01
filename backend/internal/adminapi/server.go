package adminapi

import (
	"log/slog"
	"time"

	"backend/internal/db/sqlc"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	DB      *pgxpool.Pool
	Log     *slog.Logger
	Queries sqlc.Querier

	// Things below come from Config
	TenantID        string
	AdminSessionTTL time.Duration
}
