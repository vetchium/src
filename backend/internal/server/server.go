package server

import (
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	TenantID string
	DB       *pgxpool.Pool
	Log      *slog.Logger
}
