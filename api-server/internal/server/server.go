package server

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/email"
	"vetchium-api-server.gomodule/internal/middleware"
)

// TokenConfig holds token validity durations used by handlers
type TokenConfig struct {
	// Hub tokens
	HubSignupTokenExpiry  time.Duration // Default: 24h
	HubTFATokenExpiry     time.Duration // Default: 10m
	HubSessionTokenExpiry time.Duration // Default: 24h
	HubRememberMeExpiry   time.Duration // Default: 365 days

	// Admin tokens
	AdminTFATokenExpiry     time.Duration // Default: 10m
	AdminSessionTokenExpiry time.Duration // Default: 24h

	// Org tokens
	OrgSignupTokenExpiry  time.Duration // Default: 24h
	OrgTFATokenExpiry     time.Duration // Default: 10m
	OrgSessionTokenExpiry time.Duration // Default: 24h
	OrgRememberMeExpiry   time.Duration // Default: 365 days

	// Agency tokens
	AgencySignupTokenExpiry  time.Duration // Default: 24h
	AgencyTFATokenExpiry     time.Duration // Default: 10m
	AgencySessionTokenExpiry time.Duration // Default: 24h
	AgencyRememberMeExpiry   time.Duration // Default: 365 days

	// Password reset tokens (all portals)
	PasswordResetTokenExpiry time.Duration // Default: 1h

	// Email verification tokens
	EmailVerificationTokenExpiry time.Duration // Default: 1h

	// Invitation tokens (all entity portals)
	OrgInvitationTokenExpiry    time.Duration // Default: 168h (7 days)
	AgencyInvitationTokenExpiry time.Duration // Default: 168h (7 days)
	AdminInvitationTokenExpiry  time.Duration // Default: 168h (7 days)
}

// UIConfig holds the base URLs for the various UI portals
type UIConfig struct {
	HubURL    string
	AdminURL  string
	OrgURL    string
	AgencyURL string
}

type Server struct {
	// Query interfaces for database operations
	Global        *globaldb.Queries
	RegionalIND1  *regionaldb.Queries
	RegionalUSA1  *regionaldb.Queries
	RegionalDEU1  *regionaldb.Queries

	// Raw connection pools for transaction support
	GlobalPool       *pgxpool.Pool
	RegionalIND1Pool *pgxpool.Pool
	RegionalUSA1Pool *pgxpool.Pool
	RegionalDEU1Pool *pgxpool.Pool

	// Other server dependencies
	Log           *slog.Logger
	SMTPConfig    *email.SMTPConfig
	CurrentRegion globaldb.Region
	TokenConfig   *TokenConfig
	UIConfig      *UIConfig
	Environment   string
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

// GetRegionalPool returns the connection pool for the specified region
func (s *Server) GetRegionalPool(region globaldb.Region) *pgxpool.Pool {
	switch region {
	case globaldb.RegionInd1:
		return s.RegionalIND1Pool
	case globaldb.RegionUsa1:
		return s.RegionalUSA1Pool
	case globaldb.RegionDeu1:
		return s.RegionalDEU1Pool
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
