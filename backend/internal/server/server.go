package server

import (
	"log/slog"
	"time"

	"backend/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	TenantID        string
	DB              *pgxpool.Pool
	AdminDB         sqlc.Querier
	AdminSessionTTL time.Duration
	Log             *slog.Logger
}
