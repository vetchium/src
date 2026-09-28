// Package emailchange drives the durable local/global Hub account email
// change saga (GU-ECH). No database transaction is held across a network
// call: every state transition is its own statement, conditioned on the
// state it expects, so a racing driver (the inline handler and the
// reconciliation worker may run at the same time) always converges rather
// than double-applies (GU-ECH-003).
package emailchange

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	hubauth "github.com/vetchium/src/typespec/hub/auth"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/directoryclient"
)

const (
	// reservationTTL bounds how long the 'accepted' state may wait for a
	// successful reserve before the change abandons itself (GU-ECH-002a).
	reservationTTL      = 24 * time.Hour
	operationTTL        = 7 * 24 * time.Hour
	emailChangeCodeName = "email-change-code"
	transitionLimit     = 8
)

var (
	// ErrPending reports that Advance could not reach a terminal state
	// within this call; the caller returns 202 and the operation id.
	ErrPending = errors.New("email change pending")
	// ErrIdempotencyConflict reports the same idempotency key reused with a
	// different confirm request.
	ErrIdempotencyConflict = errors.New("idempotency key conflict")
	// ErrCodeRejected reports an unknown, expired, or already-consumed
	// challenge, or a wrong code past its final attempt.
	ErrCodeRejected = errors.New("email change code rejected")
	// ErrAddressUnavailable is the terminal address_unavailable failure
	// (GU-ECH-003): another account holds the address, either globally at
	// reserve time or, rarely, locally at apply time.
	ErrAddressUnavailable = errors.New("email address unavailable")
	// ErrUnavailable is the terminal reservation_expired failure: the global
	// reservation lapsed before the change could be applied, most likely
	// from a sustained coordinator outage. The caller must request a new
	// code and confirm again.
	ErrUnavailable = errors.New("email change unavailable, retry")
)

type Directory interface {
	ReserveHubAccountEmailChange(
		context.Context, directoryspec.ReserveHubAccountEmailChangeRequest,
	) (directoryclient.EmailChangeOutcome, error)
	FinalizeHubAccountEmailChange(
		context.Context, directoryspec.FinalizeHubAccountEmailChangeRequest,
	) (directoryclient.EmailChangeOutcome, error)
	AbandonHubAccountEmailChange(
		context.Context, directoryspec.AbandonHubAccountEmailChangeRequest,
	) (directoryclient.EmailChangeOutcome, error)
}

// AccountEmailDigester is satisfied structurally by identitydigest.Key. This
// package never imports backend/internal/identitydigest directly: it is
// reachable from backend/internal/routes (hub_routes.go), which
// global-coordinator and mesh-api also import for their own unrelated
// routes, and identitydigest must never be linked into those binaries
// (GU-KEY-002). Only backend/cmd/hub-api and backend/cmd/workers construct
// the concrete key and pass it in here.
type AccountEmailDigester interface {
	HubAccountEmail(address string) []byte
	ID() string
}

// Change is the durable saga row, in the shape every state-loading query
// returns.
type Change = sqlc.GetHubAccountEmailChangeByOperationIDRow

type Service struct {
	pool      *pgxpool.Pool
	queries   *sqlc.Queries
	directory Directory
	tenantID  string
	codeKey   [32]byte
	outboxKey [32]byte
	digestKey AccountEmailDigester
	now       func() time.Time
}

type Result struct {
	OperationID string
	Completed   bool
}

func New(
	pool *pgxpool.Pool, directory Directory, tenantID string,
	codeKey, outboxKey [32]byte, digestKey AccountEmailDigester,
	now func() time.Time,
) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{
		pool: pool, queries: sqlc.New(pool), directory: directory,
		tenantID: tenantID, codeKey: codeKey, outboxKey: outboxKey,
		digestKey: digestKey, now: now,
	}
}

// CodeHash lets the request-email-change handler hash the code with the same
// key Confirm will verify it against.
func (s *Service) CodeHash(challengeID pgtype.UUID, code string) []byte {
	return credentials.VerificationCodeHash(
		s.codeKey, dbvalue.FormatUUID(challengeID), code,
	)
}

// Start accepts a confirm-email-change request, or replays one already
// accepted under the same idempotency key, then drives it (GU-ECH-002,
// GU-ECH-004).
func (s *Service) Start(
	ctx context.Context, hubUserDID, sessionID pgtype.UUID,
	request hubauth.ConfirmEmailChangeRequest, key common.IdempotencyKey,
) (Result, error) {
	aggregateID := dbvalue.FormatUUID(hubUserDID)
	digest := requestDigest(request)

	existing, err := s.queries.GetFederationOperationByIdempotency(
		ctx, sqlc.GetFederationOperationByIdempotencyParams{
			Kind: "hub-account-email-change", AggregateID: aggregateID,
			IdempotencyKey: string(key),
		},
	)
	if err == nil {
		if !bytes.Equal(existing.RequestDigest, digest) {
			return Result{}, ErrIdempotencyConflict
		}
		change, err := s.queries.GetHubAccountEmailChangeByOperationID(
			ctx, sqlc.GetHubAccountEmailChangeByOperationIDParams{
				OperationID: existing.OperationID, HubUserDid: hubUserDID,
			},
		)
		if err != nil {
			return Result{}, fmt.Errorf(
				"reload Hub account email change: %w", err,
			)
		}
		return s.Advance(ctx, change, "hub-api")
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Result{}, fmt.Errorf(
			"find Hub account email change by idempotency: %w", err,
		)
	}

	challengeID, err := dbvalue.ParseUUID(string(request.ChallengeID))
	if err != nil {
		return Result{}, ErrCodeRejected
	}
	newAddress, err := s.queries.GetHubEmailChangeChallengeAddress(
		ctx, sqlc.GetHubEmailChangeChallengeAddressParams{
			ChallengeID: challengeID, HubUserDid: hubUserDID,
			HubSessionID: sessionID,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, ErrCodeRejected
	}
	if err != nil {
		return Result{}, fmt.Errorf(
			"read Hub email change challenge address: %w", err,
		)
	}
	operationID, err := dbvalue.NewUUID()
	if err != nil {
		return Result{}, err
	}
	commandID, err := dbvalue.NewUUID()
	if err != nil {
		return Result{}, err
	}
	reserveID, err := dbvalue.NewUUID()
	if err != nil {
		return Result{}, err
	}
	finalizeID, err := dbvalue.NewUUID()
	if err != nil {
		return Result{}, err
	}
	abandonID, err := dbvalue.NewUUID()
	if err != nil {
		return Result{}, err
	}
	now := s.now().UTC()
	payloadBytes, err := json.Marshal(struct {
		OperationID string `json:"operation_id"`
	}{OperationID: dbvalue.FormatUUID(operationID)})
	if err != nil {
		return Result{}, err
	}

	accepted, err := s.queries.AcceptHubEmailChange(
		ctx, sqlc.AcceptHubEmailChangeParams{
			ChallengeID: challengeID, HubUserDid: hubUserDID,
			HubSessionID: sessionID, CodeHash: s.CodeHash(
				challengeID, request.Code,
			),
			OperationID: operationID, CommandID: commandID,
			IdempotencyKey: string(key), RequestDigest: digest,
			PayloadBytes:       payloadBytes,
			OperationExpiresAt: dbvalue.Timestamp(now.Add(operationTTL)),
			NewEmailDigest:     s.digestKey.HubAccountEmail(newAddress),
			ReserveCommandID:   reserveID, FinalizeCommandID: finalizeID,
			AbandonCommandID: abandonID,
			NotAfter:         dbvalue.Timestamp(now.Add(reservationTTL)),
			TenantID:         s.tenantID,
		},
	)
	if isEmailChangeInProgress(err) {
		return Result{}, ErrCodeRejected
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, ErrCodeRejected
	}
	if err != nil {
		return Result{}, fmt.Errorf("accept Hub email change: %w", err)
	}
	if !accepted.Verified {
		return Result{}, ErrCodeRejected
	}
	change, err := s.queries.GetHubAccountEmailChangeByOperationID(
		ctx, sqlc.GetHubAccountEmailChangeByOperationIDParams{
			OperationID: accepted.OperationID, HubUserDid: hubUserDID,
		},
	)
	if err != nil {
		return Result{}, fmt.Errorf(
			"reload accepted Hub email change: %w", err,
		)
	}
	return s.Advance(ctx, change, "hub-api")
}

// Advance drives operation through as many local transitions as it can
// without blocking indefinitely on the directory (GU-ECH-004). It returns
// once the change reaches a terminal state or a step could not complete.
func (s *Service) Advance(
	ctx context.Context, change Change, source string,
) (Result, error) {
	for i := 0; i < transitionLimit; i++ {
		switch change.State {
		case sqlc.VetchiumHubAccountEmailChangeStateAccepted:
			if !s.now().UTC().Before(change.NotAfter.Time) {
				updated, err := s.cancel(
					ctx, change, "reservation_expired",
				)
				if err != nil {
					return Result{}, err
				}
				change = updated
				continue
			}
			outcome, err := s.directory.ReserveHubAccountEmailChange(
				ctx, directoryspec.ReserveHubAccountEmailChangeRequest{
					CommandID: directoryspec.CommandID(
						dbvalue.FormatUUID(change.ReserveCommandID),
					),
					ChangeID: directoryspec.CommandID(
						dbvalue.FormatUUID(change.OperationID),
					),
					HubUserDID: hubUserDIDOf(change),
					NewEmailDigest: directoryspec.EmailDigest(
						hex.EncodeToString(change.NewEmailDigest),
					),
					NotAfter:    change.NotAfter.Time,
					DigestKeyID: directoryspec.DigestKeyID(s.digestKey.ID()),
				},
			)
			if err != nil {
				return pendingResult(change), ErrPending
			}
			if outcome.Problem != nil {
				if outcome.Problem.Type ==
					coordinatorproblem.DirectoryEmailClaimConflictError.Type {
					updated, err := s.failDirectly(
						ctx, change, "address_unavailable", source,
					)
					if err != nil {
						return Result{}, err
					}
					change = updated
					continue
				}
				if outcome.Problem.Type ==
					coordinatorproblem.DirectoryReservationExpiredError.Type ||
					outcome.Problem.Type ==
						coordinatorproblem.DirectoryReservationCancelledError.Type {
					updated, err := s.cancel(
						ctx, change, "reservation_expired",
					)
					if err != nil {
						return Result{}, err
					}
					change = updated
					continue
				}
				return pendingResult(change), ErrPending
			}
			updated, err := s.markReserved(ctx, change)
			if err != nil {
				return Result{}, err
			}
			change = updated

		case sqlc.VetchiumHubAccountEmailChangeStateReserved:
			updated, err := s.apply(ctx, change, source)
			if err != nil {
				return Result{}, err
			}
			change = updated

		case sqlc.VetchiumHubAccountEmailChangeStateApplied:
			outcome, err := s.directory.FinalizeHubAccountEmailChange(
				ctx, directoryspec.FinalizeHubAccountEmailChangeRequest{
					CommandID: directoryspec.CommandID(
						dbvalue.FormatUUID(change.FinalizeCommandID),
					),
					ChangeID: directoryspec.CommandID(
						dbvalue.FormatUUID(change.OperationID),
					),
					HubUserDID: hubUserDIDOf(change),
				},
			)
			if err != nil || outcome.Problem != nil {
				// GU-ECH-006: a DirectoryStateConflict here is impossible by
				// construction; keep retrying either way.
				return pendingResult(change), ErrPending
			}
			if err := s.succeed(ctx, change); err != nil {
				return Result{}, err
			}
			return completedResult(change), nil

		case sqlc.VetchiumHubAccountEmailChangeStateCancelling:
			outcome, err := s.directory.AbandonHubAccountEmailChange(
				ctx, directoryspec.AbandonHubAccountEmailChangeRequest{
					CommandID: directoryspec.CommandID(
						dbvalue.FormatUUID(change.AbandonCommandID),
					),
					ChangeID: directoryspec.CommandID(
						dbvalue.FormatUUID(change.OperationID),
					),
					HubUserDID: hubUserDIDOf(change),
					NotAfter:   change.NotAfter.Time,
				},
			)
			if err != nil || outcome.Problem != nil {
				return pendingResult(change), ErrPending
			}
			if err := s.fail(ctx, change, source); err != nil {
				return Result{}, err
			}
			return pendingResult(change), terminalError(change.FailureReason)

		case sqlc.VetchiumHubAccountEmailChangeStateSucceeded:
			return completedResult(change), nil

		case sqlc.VetchiumHubAccountEmailChangeStateFailed:
			return pendingResult(change), terminalError(change.FailureReason)

		default:
			return Result{}, fmt.Errorf(
				"unknown Hub account email change state %q", change.State,
			)
		}
	}
	return Result{}, fmt.Errorf(
		"Hub account email change transition limit exceeded",
	)
}

// Recover drives every non-terminal change once, for the periodic worker.
func (s *Service) Recover(ctx context.Context) (int, error) {
	rows, err := s.queries.ListRecoverableHubAccountEmailChanges(
		ctx, maxRecoveryBatch,
	)
	if err != nil {
		return 0, fmt.Errorf(
			"list recoverable Hub account email changes: %w", err,
		)
	}
	completed := 0
	for _, row := range rows {
		change := Change(row)
		result, err := s.Advance(ctx, change, "workers")
		if err != nil && !errors.Is(err, ErrPending) &&
			!errors.Is(err, ErrAddressUnavailable) &&
			!errors.Is(err, ErrUnavailable) {
			return completed, err
		}
		if result.Completed {
			completed++
		}
	}
	return completed, nil
}

const maxRecoveryBatch = 100

func (s *Service) markReserved(ctx context.Context, change Change) (Change, error) {
	updated, err := s.reload(
		ctx, change,
		func(q *sqlc.Queries) (int64, error) {
			return q.MarkHubAccountEmailChangeReserved(ctx, change.OperationID)
		},
	)
	if err != nil {
		return change, err
	}
	return updated, nil
}

// failDirectly moves 'accepted' straight to 'failed' (GU-ECH-003 row 2):
// nothing was reserved globally, so there is nothing to abandon.
func (s *Service) failDirectly(
	ctx context.Context, change Change, reason, source string,
) (Change, error) {
	status := failureStatus(reason)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return change, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	rows, err := q.FailHubAccountEmailChangeDirectly(
		ctx, sqlc.FailHubAccountEmailChangeDirectlyParams{
			TenantID: s.tenantID, HubUserDid: dbvalue.FormatUUID(change.HubUserDid),
			Source: source, IdempotencyKey: dbvalue.Text(
				dbvalue.FormatUUID(change.OperationID),
			),
			FailureReason: reason, OperationID: change.OperationID,
		},
	)
	if err != nil {
		return change, fmt.Errorf(
			"fail Hub account email change directly: %w", err,
		)
	}
	if rows == 1 {
		if _, err := q.ResolveFederationOperation(
			ctx, sqlc.ResolveFederationOperationParams{
				OperationID: change.OperationID,
				State:       sqlc.VetchiumFederationOperationStateFailed,
				ResponseStatus: pgtype.Int4{
					Int32: int32(status), Valid: true,
				},
				ResponseCiphertext: []byte{},
			},
		); err != nil {
			return change, fmt.Errorf(
				"resolve failed Hub account email change: %w", err,
			)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return change, err
	}
	return s.reget(ctx, change)
}

// cancel moves 'accepted' or 'reserved' into 'cancelling', durably recording
// why before the abandon call goes out (GU-ECH-003 row 3).
func (s *Service) cancel(
	ctx context.Context, change Change, reason string,
) (Change, error) {
	return s.reload(
		ctx, change,
		func(q *sqlc.Queries) (int64, error) {
			return q.MarkHubAccountEmailChangeCancelling(
				ctx, sqlc.MarkHubAccountEmailChangeCancellingParams{
					FailureReason: dbvalue.Text(reason),
					OperationID:   change.OperationID,
				},
			)
		},
	)
}

// apply runs the local effects in one statement guarded by state = 'reserved'
// (GU-ECH-004 step 2). A local unique violation on the target address moves
// the change to 'cancelling' instead of retrying forever (GU-ECH-003 row 5).
func (s *Service) apply(ctx context.Context, change Change, source string) (Change, error) {
	notice, err := credentials.Encrypt(s.outboxKey, []byte("{}"))
	if err != nil {
		return change, err
	}
	_, err = s.queries.ApplyHubAccountEmailChange(
		ctx, sqlc.ApplyHubAccountEmailChangeParams{
			OperationID: change.OperationID, NoticePayloadCiphertext: notice,
			TenantID: s.tenantID, Source: source,
			IdempotencyKey: dbvalue.Text(dbvalue.FormatUUID(change.OperationID)),
		},
	)
	if isAccountEmailTaken(err) {
		return s.cancel(ctx, change, "address_unavailable")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return s.reget(ctx, change)
	}
	if err != nil {
		return change, fmt.Errorf("apply Hub account email change: %w", err)
	}
	return s.reget(ctx, change)
}

func (s *Service) succeed(ctx context.Context, change Change) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	rows, err := q.MarkHubAccountEmailChangeSucceeded(ctx, change.OperationID)
	if err != nil {
		return fmt.Errorf("mark Hub account email change succeeded: %w", err)
	}
	if rows == 1 {
		if _, err := q.ResolveFederationOperation(
			ctx, sqlc.ResolveFederationOperationParams{
				OperationID: change.OperationID,
				State:       sqlc.VetchiumFederationOperationStateSucceeded,
				ResponseStatus: pgtype.Int4{
					Int32: 204, Valid: true,
				},
				ResponseCiphertext: []byte{},
			},
		); err != nil {
			return fmt.Errorf(
				"resolve succeeded Hub account email change: %w", err,
			)
		}
	}
	return tx.Commit(ctx)
}

func (s *Service) fail(ctx context.Context, change Change, source string) error {
	status := failureStatus(change.FailureReason.String)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	rows, err := q.MarkHubAccountEmailChangeFailed(
		ctx, sqlc.MarkHubAccountEmailChangeFailedParams{
			TenantID: s.tenantID, HubUserDid: dbvalue.FormatUUID(change.HubUserDid),
			Source: source, IdempotencyKey: dbvalue.Text(
				dbvalue.FormatUUID(change.OperationID),
			),
			FailureReason: change.FailureReason.String,
			OperationID:   change.OperationID,
		},
	)
	if err != nil {
		return fmt.Errorf("mark Hub account email change failed: %w", err)
	}
	if rows == 1 {
		if _, err := q.ResolveFederationOperation(
			ctx, sqlc.ResolveFederationOperationParams{
				OperationID: change.OperationID,
				State:       sqlc.VetchiumFederationOperationStateFailed,
				ResponseStatus: pgtype.Int4{
					Int32: int32(status), Valid: true,
				},
				ResponseCiphertext: []byte{},
			},
		); err != nil {
			return fmt.Errorf(
				"resolve failed Hub account email change: %w", err,
			)
		}
	}
	return tx.Commit(ctx)
}

// reload runs a conditional transition; a zero-row result means another
// driver already moved the state, so it re-reads instead of erroring
// (GU-ECH-003).
func (s *Service) reload(
	ctx context.Context, change Change, transition func(*sqlc.Queries) (int64, error),
) (Change, error) {
	rows, err := transition(s.queries)
	if err != nil {
		return change, err
	}
	_ = rows
	return s.reget(ctx, change)
}

func (s *Service) reget(ctx context.Context, change Change) (Change, error) {
	current, err := s.queries.GetHubAccountEmailChangeByOperationID(
		ctx, sqlc.GetHubAccountEmailChangeByOperationIDParams{
			OperationID: change.OperationID, HubUserDid: change.HubUserDid,
		},
	)
	if err != nil {
		return change, fmt.Errorf("reload Hub account email change: %w", err)
	}
	return current, nil
}

func failureStatus(reason string) int {
	if reason == "address_unavailable" {
		return 409
	}
	return 503
}

func terminalError(reason pgtype.Text) error {
	if reason.String == "address_unavailable" {
		return ErrAddressUnavailable
	}
	return ErrUnavailable
}

func hubUserDIDOf(change Change) hubspec.HubUserDID {
	return hubspec.HubUserDID(dbvalue.FormatUUID(change.HubUserDid))
}

func pendingResult(change Change) Result {
	return Result{OperationID: dbvalue.FormatUUID(change.OperationID)}
}

func completedResult(change Change) Result {
	return Result{
		OperationID: dbvalue.FormatUUID(change.OperationID), Completed: true,
	}
}

// isAccountEmailTaken reports the local unique-constraint safety net firing
// at apply time (GU-ECH-003 row 5): the address is not supposed to be
// locally available once the global reservation held it, but this remains a
// defense-in-depth check independent of that reservation.
func isAccountEmailTaken(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) &&
		databaseError.Code == "23505" &&
		databaseError.ConstraintName == "hub_users_email_address_key"
}

func isEmailChangeInProgress(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) &&
		databaseError.Code == "23505" &&
		databaseError.ConstraintName == "hub_account_email_changes_one_live"
}

func requestDigest(request hubauth.ConfirmEmailChangeRequest) []byte {
	encoded, _ := json.Marshal(request)
	digest := sha256.Sum256(encoded)
	return digest[:]
}
