package handlerauth

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// PasswordReset completes a password reset for one portal. Only the queries,
// the problem vocabulary and the challenge differ between portals; the order
// of the steps is a security decision that must not.
type PasswordReset struct {
	ResetTokenHash []byte
	NewPassword    string
	IdempotencyKey common.IdempotencyKey
	TenantID       string

	InvalidToken problem.Details
	Challenge    string

	// ResolveUser returns pgx.ErrNoRows when the token matches no live reset.
	ResolveUser func(
		context.Context, *sqlc.Queries, []byte,
	) (pgtype.UUID, error)

	// LockUser serializes credential replacement for one user.
	LockUser func(context.Context, *sqlc.Queries, pgtype.UUID) error

	// Complete reports whether the reset was still live when it committed.
	Complete func(
		context.Context, *sqlc.Queries, CompletedPasswordReset,
	) (bool, error)
}

// CompletedPasswordReset carries the values the portal's completion query
// needs, so the shared flow does not have to know its parameter struct.
type CompletedPasswordReset struct {
	ResetTokenHash []byte
	PasswordHash   string
	TenantID       string
	IdempotencyKey pgtype.Text
}

// Run resolves the reset token, takes the credential lock, and replaces the
// password in one transaction.
//
// The token is resolved before the new password is hashed. Hashing first would
// spend a bcrypt round on every request carrying a bad token, which turns the
// endpoint into a cheap way to burn server CPU. Reset tokens are unguessable
// random values, so returning early reveals nothing the response does not.
func (p PasswordReset) Run(
	ctx context.Context, q *sqlc.Queries,
) (Result[struct{}], *Problem, error) {
	userID, err := p.ResolveUser(ctx, q, p.ResetTokenHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return AuthenticationFailure[struct{}](p.InvalidToken, p.Challenge)
	}
	if err != nil {
		return Result[struct{}]{}, nil, err
	}
	if err := p.LockUser(ctx, q, userID); err != nil {
		return Result[struct{}]{}, nil, err
	}
	hash, err := credentials.HashPassword(p.NewPassword)
	if err != nil {
		return Result[struct{}]{}, nil, err
	}
	completed, err := p.Complete(ctx, q, CompletedPasswordReset{
		ResetTokenHash: p.ResetTokenHash,
		PasswordHash:   hash,
		TenantID:       p.TenantID,
		IdempotencyKey: dbvalue.Text(string(p.IdempotencyKey)),
	})
	if err != nil {
		return Result[struct{}]{}, nil, err
	}
	if !completed {
		return AuthenticationFailure[struct{}](p.InvalidToken, p.Challenge)
	}
	return Result[struct{}]{
		Status: http.StatusNoContent, Body: struct{}{},
	}, nil, nil
}

// ChangePassword replaces the authenticated principal's password. A change
// that affects no row means the session no longer identifies a live user, so
// it answers with the portal's authentication challenge rather than success.
func ChangePassword(
	s apiserver.RuntimeServer, w http.ResponseWriter, r *http.Request,
	operation, newPassword string,
	change func(context.Context, string) (bool, error),
	unauthenticated problem.Details, challenge string,
) {
	runtime := s.HandlerRuntime()
	hash, err := credentials.HashPassword(newPassword)
	if err != nil {
		runtime.InternalError(r.Context(), w, "hash "+operation, err)
		return
	}
	changed, err := change(r.Context(), hash)
	if err != nil {
		runtime.InternalError(r.Context(), w, operation, err)
		return
	}
	if !changed {
		runtime.AuthenticationProblem(
			r.Context(), w, unauthenticated, challenge,
		)
		return
	}
	runtime.Empty(r.Context(), w, http.StatusNoContent)
}
