package server

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/proxy"
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
	// Global database (for routing lookups)
	Global     *globaldb.Queries
	GlobalPool *pgxpool.Pool

	// This server's regional database (only one)
	Regional     *regionaldb.Queries
	RegionalPool *pgxpool.Pool

	// Server identity
	CurrentRegion globaldb.Region
	Log           *slog.Logger
	TokenConfig   *TokenConfig
	UIConfig      *UIConfig
	Environment   string

	// Internal endpoints for cross-region proxy
	// Map of region -> base URL (e.g., "ind1" -> "http://regional-api-server-ind1:8080")
	InternalEndpoints map[globaldb.Region]string
}

// Logger returns the logger from context with request ID, or falls back to base logger.
func (s *Server) Logger(ctx context.Context) *slog.Logger {
	return middleware.LoggerFromContext(ctx, s.Log)
}

// ProxyToRegion proxies the request to the specified region's internal endpoint.
func (s *Server) ProxyToRegion(w http.ResponseWriter, r *http.Request, targetRegion globaldb.Region, bodyBytes []byte) {
	endpoint, ok := s.InternalEndpoints[targetRegion]
	if !ok {
		s.Logger(r.Context()).Error("no internal endpoint for region", "region", targetRegion)
		http.Error(w, "", http.StatusInternalServerError)
		return
	}
	proxy.ToRegion(w, r, endpoint, bodyBytes)
}
