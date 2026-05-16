package server

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
)

// GlobalServer holds dependencies for the global service (admin HTTP handlers).
// It has direct access to the global database plus all regional databases (for
// admin marketplace operations that need to read/write regional service listing data).
type GlobalServer struct {
	BaseServer

	// All regional database connections (keyed by region).
	// Populated on startup; used by admin marketplace handlers.
	RegionalPools map[globaldb.Region]*pgxpool.Pool
	RegionalDBs   map[globaldb.Region]*regionaldb.Queries

	// S3 storage config for admin-managed assets
	StorageConfig *StorageConfig
}

// GetRegionalDB returns the regional DB queries for a given region, or nil if unknown.
func (s *GlobalServer) GetRegionalDB(region globaldb.Region) *regionaldb.Queries {
	return s.RegionalDBs[region]
}

// GetRegionalPool returns the regional DB pool for a given region, or nil if unknown.
func (s *GlobalServer) GetRegionalPool(region globaldb.Region) *pgxpool.Pool {
	return s.RegionalPools[region]
}

// WithRegionalTx executes fn within a transaction on the given region's DB.
func (s *GlobalServer) WithRegionalTx(ctx context.Context, region globaldb.Region, fn func(*regionaldb.Queries) error) error {
	pool := s.RegionalPools[region]
	if pool == nil {
		return &ErrUnknownRegion{Region: string(region)}
	}
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		qtx := regionaldb.New(tx)
		return fn(qtx)
	})
}

// GetGlobalStorageConfig returns the global S3 storage config (for admin-managed assets).
func (s *GlobalServer) GetGlobalStorageConfig() *StorageConfig {
	return s.StorageConfig
}

// AllRegions returns all regions that have a regional DB configured.
func (s *GlobalServer) AllRegions() []globaldb.Region {
	regions := make([]globaldb.Region, 0, len(s.RegionalPools))
	for r := range s.RegionalPools {
		regions = append(regions, r)
	}
	return regions
}

// ErrUnknownRegion is returned when an admin handler cannot find a regional pool.
type ErrUnknownRegion struct {
	Region string
}

func (e *ErrUnknownRegion) Error() string {
	return "unknown region: " + e.Region
}
