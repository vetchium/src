package server

import (
	"context"
	"log/slog"
	"time"

	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/email"
	"vetchium-api-server.gomodule/internal/middleware"
)

// TokenConfig holds token validity durations used by handlers
type TokenConfig struct {
	HubSignupTokenExpiry time.Duration // Default: 24h
}

type Server struct {
	Global        *globaldb.Queries
	RegionalIND1  *regionaldb.Queries
	RegionalUSA1  *regionaldb.Queries
	RegionalDEU1  *regionaldb.Queries
	Log           *slog.Logger
	SMTPConfig    *email.SMTPConfig
	CurrentRegion globaldb.Region
	TokenConfig   *TokenConfig
}

func (s *Server) GetRegionalDB(region globaldb.Region) *regionaldb.Queries {
	switch region {
	case globaldb.RegionInd1:
		return s.RegionalIND1
	case globaldb.RegionUsa1:
		return s.RegionalUSA1
	case globaldb.RegionDeu1:
		return s.RegionalDEU1
	default:
		return nil
	}
}

// GetCurrentRegionalDB returns the regional database for the current server's region
func (s *Server) GetCurrentRegionalDB() *regionaldb.Queries {
	return s.GetRegionalDB(s.CurrentRegion)
}

// Logger returns the logger from context with request ID, or falls back to base logger.
func (s *Server) Logger(ctx context.Context) *slog.Logger {
	return middleware.LoggerFromContext(ctx, s.Log)
}
