package server

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
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

// WithRegionalTx executes a function within a regional database transaction.
// Always uses s.RegionalPool since each server has only one regional DB.
func (s *RegionalServer) WithRegionalTx(ctx context.Context, fn func(*regionaldb.Queries) error) error {
	return pgx.BeginFunc(ctx, s.RegionalPool, func(tx pgx.Tx) error {
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
