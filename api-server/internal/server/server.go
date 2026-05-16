package server

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
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

	// Password reset tokens (all portals)
	PasswordResetTokenExpiry time.Duration // Default: 1h

	// Email verification tokens
	EmailVerificationTokenExpiry time.Duration // Default: 1h

	// Invitation tokens (all entity portals)
	OrgInvitationTokenExpiry   time.Duration // Default: 168h (7 days)
	AdminInvitationTokenExpiry time.Duration // Default: 168h (7 days)
}

// UIConfig holds the base URLs for the various UI portals
type UIConfig struct {
	HubURL   string
	AdminURL string
	OrgURL   string
}

// StorageConfig holds S3-compatible object storage connection parameters for one
// region. Each regional API server holds N StorageConfig values (one per region) in
// RegionalServer.AllStorageConfigs, addressed by globaldb.Region. The correct
// config for any blob operation is selected by the owning entity's home region —
// mirroring the DB pool selection convention from ADR-001 §4.1.
type StorageConfig struct {
	Endpoint        string
	AccessKeyID     string
	SecretAccessKey string
	Region          string
	Bucket          string
}

type BaseServer struct {
	// Global database (for routing lookups)
	Global     *globaldb.Queries
	GlobalPool *pgxpool.Pool

	Log         *slog.Logger
	TokenConfig *TokenConfig
	UIConfig    *UIConfig
	Environment string
}

type PublicServer interface {
	GetGlobal() *globaldb.Queries
	GetGlobalStorageConfig() *StorageConfig
	Logger(ctx context.Context) *slog.Logger
}

func (s *BaseServer) GetGlobal() *globaldb.Queries {
	return s.Global
}

type RegionalServer struct {
	BaseServer

	// This server's regional database (only one)
	Regional     *regionaldb.Queries
	RegionalPool *pgxpool.Pool

	// All regional databases (for cross-region reads such as eligibility checks)
	AllRegionalDBs map[globaldb.Region]*regionaldb.Queries

	// All regional connection pools (for cross-region writes)
	AllRegionalPools map[globaldb.Region]*pgxpool.Pool

	// All regional S3 storage configs
	AllStorageConfigs map[globaldb.Region]*StorageConfig

	// Global S3 storage config (for admin-managed assets like tag icons)
	GlobalStorageConfig *StorageConfig

	// Server identity
	CurrentRegion globaldb.Region
}

// GetRegionalDB returns the regional DB queries for a given region, or nil if unknown.
func (s *RegionalServer) GetRegionalDB(region globaldb.Region) *regionaldb.Queries {
	return s.AllRegionalDBs[region]
}

// GetRegionalPool returns the regional DB pool for a given region, or nil if unknown.
func (s *RegionalServer) GetRegionalPool(region globaldb.Region) *pgxpool.Pool {
	return s.AllRegionalPools[region]
}

// GetStorageConfig returns the S3 storage config for a given region, or nil if unknown.
func (s *RegionalServer) GetStorageConfig(region globaldb.Region) *StorageConfig {
	return s.AllStorageConfigs[region]
}

// GetGlobalStorageConfig returns the S3 storage config for global assets (admin-managed, e.g. tag icons).
func (s *RegionalServer) GetGlobalStorageConfig() *StorageConfig {
	return s.GlobalStorageConfig
}

// RegionalForCtx returns the regional DB queries for the authenticated user's home region.
// It checks org region first, then hub region, then falls back to s.Regional.
// This is the correct DB to use for any data owned by the authenticated user.
func (s *RegionalServer) RegionalForCtx(ctx context.Context) *regionaldb.Queries {
	if region := middleware.OrgRegionFromContext(ctx); region != "" {
		if db := s.AllRegionalDBs[globaldb.Region(region)]; db != nil {
			return db
		}
	}
	if region := middleware.HubRegionFromContext(ctx); region != "" {
		if db := s.AllRegionalDBs[globaldb.Region(region)]; db != nil {
			return db
		}
	}
	return s.Regional
}

// Logger returns the logger from context with request ID, or falls back to base logger.
func (s *BaseServer) Logger(ctx context.Context) *slog.Logger {
	return middleware.LoggerFromContext(ctx, s.Log)
}

// WithGlobalTx executes a function within a global database transaction.
func (s *BaseServer) WithGlobalTx(ctx context.Context, fn func(*globaldb.Queries) error) error {
	return pgx.BeginFunc(ctx, s.GlobalPool, func(tx pgx.Tx) error {
		qtx := s.Global.WithTx(tx)
		return fn(qtx)
	})
}

// WithRegionalTxFor executes fn within a transaction on the given region's DB.
// Use this when the home region of the entity being written differs from
// s.CurrentRegion. For writes against s.CurrentRegion, prefer the shorter
// WithRegionalTx (which is equivalent to WithRegionalTxFor(ctx, s.CurrentRegion, fn)).
func (s *RegionalServer) WithRegionalTxFor(ctx context.Context, region globaldb.Region, fn func(*regionaldb.Queries) error) error {
	pool := s.AllRegionalPools[region]
	if pool == nil {
		return fmt.Errorf("no pool for region %q", region)
	}
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		qtx := regionaldb.New(tx)
		return fn(qtx)
	})
}
