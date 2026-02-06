package server

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
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

// WithGlobalTx executes a function within a global database transaction.
// If the function returns an error, the transaction is rolled back.
// Otherwise, the transaction is committed.
//
// Errors returned from fn are propagated as-is, preserving error types
// for granular HTTP status code mapping.
func (s *Server) WithGlobalTx(ctx context.Context, fn func(*globaldb.Queries) error) error {
	return pgx.BeginFunc(ctx, s.GlobalPool, func(tx pgx.Tx) error {
		qtx := s.Global.WithTx(tx)
		return fn(qtx)
	})
}

// WithRegionalTx executes a function within a regional database transaction.
func (s *Server) WithRegionalTx(ctx context.Context, pool *pgxpool.Pool, fn func(*regionaldb.Queries) error) error {
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
