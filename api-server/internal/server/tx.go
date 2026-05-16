package server

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
)

// Custom error types for distinguishing failure modes
var (
	// ErrNotFound indicates a required resource was not found (maps to 404)
	ErrNotFound = errors.New("resource not found")

	// ErrConflict indicates a unique constraint violation (maps to 409)
	ErrConflict = errors.New("resource conflict")

	// ErrInvalidState indicates resource exists but in wrong state (maps to 422)
	ErrInvalidState = errors.New("invalid state")
)

// WithRegionalTx executes a function within a regional database transaction.
// Uses the authenticated user's home region pool from context when available,
// so writes always land in the user's home region regardless of which server
// is handling the request (ADR-001 §4.1).
func (s *RegionalServer) WithRegionalTx(ctx context.Context, fn func(*regionaldb.Queries) error) error {
	pool := s.RegionalPool
	if region := middleware.OrgRegionFromContext(ctx); region != "" {
		if p := s.AllRegionalPools[globaldb.Region(region)]; p != nil {
			pool = p
		}
	} else if region := middleware.HubRegionFromContext(ctx); region != "" {
		if p := s.AllRegionalPools[globaldb.Region(region)]; p != nil {
			pool = p
		}
	}
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		qtx := regionaldb.New(tx)
		return fn(qtx)
	})
}

// IsUniqueViolation checks if an error is a unique constraint violation
func IsUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	return strings.Contains(errStr, "duplicate key") || strings.Contains(errStr, "unique constraint")
}
