// Package idempotency executes and replays idempotent API mutations.
package idempotency

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
)

// Cipher protects persisted response bodies, which can contain credentials.
type Cipher struct {
	Encrypt func([]byte) ([]byte, error)
	Decrypt func([]byte) ([]byte, error)
}

// APIProblem describes an expected problem returned by mutation work.
type APIProblem struct {
	Details         problem.Details
	WWWAuthenticate string
}

// Result is the successful response persisted for subsequent replays.
type Result[T any] struct {
	Status int
	Body   T
}

// Request identifies one globally named operation and its replay binding.
// Operation names must be unique across every portal using the shared ledger.
type Request struct {
	Operation string
	BindingID string
	Key       common.IdempotencyKey
	Payload   any
	ExpiresAt time.Time
}

// Key validates and returns the idempotency key supplied by the caller.
func Key(
	s *apiserver.Runtime, w http.ResponseWriter, r *http.Request,
) (common.IdempotencyKey, bool) {
	key := common.IdempotencyKey(r.Header.Get("Idempotency-Key"))
	if !common.IsIdempotencyKey(key) {
		s.ValidationFailed(r.Context(), w, []string{"Idempotency-Key"})
		return "", false
	}
	return key, true
}

// Run executes work once and replays its persisted response for matching
// requests made with the same operation, binding, and idempotency key.
func Run[T any](
	s *apiserver.Runtime, w http.ResponseWriter, r *http.Request,
	request Request, cipher Cipher,
	work func(*sqlc.Queries) (Result[T], *APIProblem, error),
) {
	requestJSON, err := json.Marshal(request.Payload)
	if err != nil {
		s.InternalError(r.Context(), w, "encode idempotent request", err)
		return
	}
	digest := sha256.Sum256(requestJSON)
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		s.InternalError(r.Context(), w, "begin idempotent operation", err)
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	queries := sqlc.New(tx)
	lockID := fmt.Sprintf(
		"%d:%s%d:%s%d:%s",
		len(request.Operation), request.Operation,
		len(request.BindingID), request.BindingID,
		len(request.Key), request.Key,
	)
	if err := queries.LockIdempotency(r.Context(), lockID); err != nil {
		s.InternalError(r.Context(), w, "lock idempotent operation", err)
		return
	}
	lookup := sqlc.GetIdempotencyParams{
		Operation: request.Operation, BindingID: request.BindingID,
		IdempotencyKey: string(request.Key),
	}
	if err := queries.DeleteExpiredIdempotency(
		r.Context(), sqlc.DeleteExpiredIdempotencyParams(lookup),
	); err != nil {
		s.InternalError(r.Context(), w, "delete expired idempotency", err)
		return
	}
	existing, err := queries.GetIdempotency(r.Context(), lookup)
	if err == nil {
		if !bytes.Equal(existing.RequestDigest, digest[:]) {
			_ = tx.Rollback(r.Context())
			s.Problem(r.Context(), w, problem.IdempotencyKeyConflictError)
			return
		}
		plaintext, err := cipher.Decrypt(existing.ResponseCiphertext)
		if err != nil {
			s.InternalError(r.Context(), w, "decrypt idempotent response", err)
			return
		}
		var body T
		if err := json.Unmarshal(plaintext, &body); err != nil {
			s.InternalError(r.Context(), w, "decode idempotent response", err)
			return
		}
		if err := tx.Commit(r.Context()); err != nil {
			s.InternalError(r.Context(), w, "commit idempotent replay", err)
			return
		}
		writeResponse(s, w, r, int(existing.ResponseStatus.Int32), body)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		s.InternalError(r.Context(), w, "get idempotency", err)
		return
	}
	if err := queries.CreateIdempotency(
		r.Context(), sqlc.CreateIdempotencyParams{
			Operation: request.Operation, BindingID: request.BindingID,
			IdempotencyKey: string(request.Key), RequestDigest: digest[:],
			ExpiresAt: pgtype.Timestamptz{
				Time: request.ExpiresAt, Valid: true,
			},
		},
	); err != nil {
		s.InternalError(r.Context(), w, "create idempotency", err)
		return
	}
	result, apiError, err := work(queries)
	if err != nil {
		s.InternalError(r.Context(), w, request.Operation, err)
		return
	}
	if apiError != nil {
		_ = tx.Rollback(r.Context())
		if apiError.WWWAuthenticate != "" {
			s.Problem(
				r.Context(), w, apiError.Details,
				apiError.WWWAuthenticate,
			)
		} else {
			s.Problem(r.Context(), w, apiError.Details)
		}
		return
	}
	responseJSON, err := json.Marshal(result.Body)
	if err != nil {
		s.InternalError(r.Context(), w, "encode idempotent response", err)
		return
	}
	ciphertext, err := cipher.Encrypt(responseJSON)
	if err != nil {
		s.InternalError(r.Context(), w, "encrypt idempotent response", err)
		return
	}
	if err := queries.CompleteIdempotency(
		r.Context(), sqlc.CompleteIdempotencyParams{
			Operation: request.Operation, BindingID: request.BindingID,
			IdempotencyKey: string(request.Key),
			ResponseStatus: pgtype.Int4{
				Int32: int32(result.Status), Valid: true,
			},
			ResponseCiphertext: ciphertext,
		},
	); err != nil {
		s.InternalError(r.Context(), w, "complete idempotency", err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.InternalError(r.Context(), w, "commit idempotent operation", err)
		return
	}
	writeResponse(s, w, r, result.Status, result.Body)
}

func writeResponse[T any](
	s *apiserver.Runtime, w http.ResponseWriter, r *http.Request,
	status int, body T,
) {
	w.Header().Set("Cache-Control", "no-store")
	if status == http.StatusNoContent || status == http.StatusAccepted {
		s.Empty(r.Context(), w, status)
		return
	}
	s.JSON(r.Context(), w, status, body)
}
