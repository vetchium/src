package meshapi

import (
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	DB  *pgxpool.Pool
	Log *slog.Logger

	// Things below come from Config
	TenantID string
}
