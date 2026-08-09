package admin

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
)

type apiProblem struct {
	details         problem.Details
	wwwAuthenticate string
}

type idempotentResult[T any] struct {
	status    int
	body      T
	expiresAt time.Time
}

type adminCredentialLock struct {
	userID       pgtype.UUID
	emailAddress string
}

func withAdminCredentialLock[T any](
	s *adminapi.Server, r *http.Request, identity adminCredentialLock,
	work func(sqlc.Querier) (T, error),
) (T, error) {
	var zero T
	// Handler unit tests use a query stub without a pool. Production servers
	// always take the transaction-scoped row-lock path below.
	if s.DB == nil {
		return work(s.Queries)
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		return zero, err
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	queries := sqlc.New(tx)
	if identity.emailAddress != "" {
		_, err = queries.LockAdminEmailCredentialMutation(
			r.Context(), identity.emailAddress,
		)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return zero, err
		}
	} else {
		_, err = queries.LockAdminUserCredentialMutation(
			r.Context(), identity.userID,
		)
		if err != nil {
			return zero, err
		}
	}
	result, err := work(queries)
	if err != nil {
		return zero, err
	}
	if err := tx.Commit(r.Context()); err != nil {
		return zero, err
	}
	return result, nil
}

func idempotencyKey(
	s *adminapi.Server, w http.ResponseWriter, r *http.Request,
) (common.IdempotencyKey, bool) {
	key := common.IdempotencyKey(r.Header.Get("Idempotency-Key"))
	if !common.IsIdempotencyKey(key) {
		s.ValidationFailed(
			r.Context(), w, []string{"Idempotency-Key"},
		)
		return "", false
	}
	return key, true
}

func runIdempotent[T any](
	s *adminapi.Server, w http.ResponseWriter, r *http.Request,
	operation, bindingID string, key common.IdempotencyKey,
	request any, expiresAt time.Time,
	work func(*sqlc.Queries) (idempotentResult[T], *apiProblem, error),
) {
	requestJSON, err := json.Marshal(request)
	if err != nil {
		s.InternalError(r.Context(), w, "encode idempotent request", err)
		return
	}
	digest := adminapi.CanonicalDigest(requestJSON)
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		s.InternalError(r.Context(), w, "begin idempotent operation", err)
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	queries := sqlc.New(tx)
	lockID := fmt.Sprintf(
		"%d:%s%d:%s%d:%s",
		len(operation), operation,
		len(bindingID), bindingID,
		len(key), key,
	)
	if err := queries.LockAdminIdempotency(r.Context(), lockID); err != nil {
		s.InternalError(r.Context(), w, "lock idempotent operation", err)
		return
	}
	lookup := sqlc.GetAdminIdempotencyParams{
		Operation: operation, BindingID: bindingID,
		IdempotencyKey: string(key),
	}
	if err := queries.DeleteExpiredAdminIdempotency(
		r.Context(), sqlc.DeleteExpiredAdminIdempotencyParams(lookup),
	); err != nil {
		s.InternalError(r.Context(), w, "delete expired idempotency", err)
		return
	}
	existing, err := queries.GetAdminIdempotency(r.Context(), lookup)
	if err == nil {
		if !bytes.Equal(existing.RequestDigest, digest[:]) {
			_ = tx.Rollback(r.Context())
			s.Problem(r.Context(), w, problem.IdempotencyKeyConflictError)
			return
		}
		plaintext, err := adminapi.Decrypt(
			s.CredentialSubkey("idempotency"), existing.ResponseCiphertext,
		)
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
		writeIdempotentResponse(
			s, w, r, int(existing.ResponseStatus.Int32), body,
		)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		s.InternalError(r.Context(), w, "get idempotency", err)
		return
	}
	if err := queries.CreateAdminIdempotency(
		r.Context(), sqlc.CreateAdminIdempotencyParams{
			Operation: operation, BindingID: bindingID,
			IdempotencyKey: string(key), RequestDigest: digest[:],
			ExpiresAt: adminapi.Timestamp(expiresAt),
		},
	); err != nil {
		s.InternalError(r.Context(), w, "create idempotency", err)
		return
	}
	result, apiError, err := work(queries)
	if err != nil {
		s.InternalError(r.Context(), w, operation, err)
		return
	}
	if apiError != nil {
		_ = tx.Rollback(r.Context())
		if apiError.wwwAuthenticate != "" {
			s.Problem(
				r.Context(), w, apiError.details,
				apiError.wwwAuthenticate,
			)
		} else {
			s.Problem(r.Context(), w, apiError.details)
		}
		return
	}
	responseJSON, err := json.Marshal(result.body)
	if err != nil {
		s.InternalError(r.Context(), w, "encode idempotent response", err)
		return
	}
	ciphertext, err := adminapi.Encrypt(
		s.CredentialSubkey("idempotency"), responseJSON,
	)
	if err != nil {
		s.InternalError(r.Context(), w, "encrypt idempotent response", err)
		return
	}
	if err := queries.CompleteAdminIdempotency(
		r.Context(), sqlc.CompleteAdminIdempotencyParams{
			Operation: operation, BindingID: bindingID,
			IdempotencyKey: string(key),
			ResponseStatus: pgtype.Int4{
				Int32: int32(result.status), Valid: true,
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
	writeIdempotentResponse(s, w, r, result.status, result.body)
}

func writeIdempotentResponse[T any](
	s *adminapi.Server, w http.ResponseWriter, r *http.Request,
	status int, body T,
) {
	w.Header().Set("Cache-Control", "no-store")
	if status == http.StatusNoContent || status == http.StatusAccepted {
		w.WriteHeader(status)
		return
	}
	s.JSON(r.Context(), w, status, body)
}
