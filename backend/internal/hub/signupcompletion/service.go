// Package signupcompletion coordinates the durable local/global Hub signup
// saga. No database transaction is held across a network call.
package signupcompletion

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	hubauth "github.com/vetchium/src/typespec/hub/auth"
	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/directoryclient"
	hubusers "backend/internal/hub/users"
)

const (
	reservationTTL = 48 * time.Hour
	operationTTL   = 7 * 24 * time.Hour
	handleAttempts = 5
)

var (
	ErrInvalidToken        = errors.New("invalid signup token")
	ErrIdempotencyConflict = errors.New("idempotency key conflict")
	ErrPending             = errors.New("signup completion pending")
	ErrExpired             = errors.New("signup completion expired")
)

// ErrRegisteredElsewhere reports that the account email is already claimed by
// a Hub user at another tenant (GU-SIG-004). HomeTenantID is empty when the
// coordinator's resolve-hub-account-email lookup itself failed; the caller
// still fails the completion (reserve-hub-principal already gave a definite
// conflict), just without naming a region.
type ErrRegisteredElsewhere struct {
	HomeTenantID string
}

func (e *ErrRegisteredElsewhere) Error() string {
	return "Hub account email is already registered at another tenant"
}

type Directory interface {
	ReserveHubPrincipal(
		context.Context, directoryspec.ReserveHubPrincipalRequest,
	) (directoryclient.Outcome, error)
	ActivateHubPrincipal(
		context.Context, directoryspec.ActivateHubPrincipalRequest,
	) (directoryclient.Outcome, error)
	ResolveHubAccountEmail(
		context.Context, directoryspec.ResolveHubAccountEmailRequest,
	) (directoryspec.ResolveHubAccountEmailResponse, *problem.Details, error)
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

type Service struct {
	pool       *pgxpool.Pool
	queries    *sqlc.Queries
	directory  Directory
	tenantID   string
	payloadKey [32]byte
	digestKey  AccountEmailDigester
	log        *slog.Logger
	now        func() time.Time
}

type payload struct {
	EmailAddress      string `json:"email_address"`
	DisplayName       string `json:"display_name"`
	PasswordHash      string `json:"password_hash"`
	PreferredLanguage string `json:"preferred_language"`
	ResidentCountry   string `json:"resident_country"`
}

type Result struct {
	OperationID string
	Completed   bool
	Response    hubauth.CompleteSignupResponse
}

func New(
	pool *pgxpool.Pool, directory Directory, tenantID string,
	payloadKey [32]byte, digestKey AccountEmailDigester, log *slog.Logger,
	now func() time.Time,
) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{
		pool: pool, queries: sqlc.New(pool), directory: directory,
		tenantID: tenantID, payloadKey: payloadKey, digestKey: digestKey,
		log: log, now: now,
	}
}

//vetchium:multiple-commits commits each step of the signup around its global-coordinator call
func (s *Service) Start(
	ctx context.Context, request hubauth.CompleteSignupRequest,
	key common.IdempotencyKey,
	eligible func(common.CountryCode) bool,
) (Result, error) {
	tokenHash := credentials.TokenHash(string(request.SignupToken))
	digest, err := requestDigest(request)
	if err != nil {
		return Result{}, err
	}
	operation, err := s.queries.GetHubSignupCompletionByTokenHash(ctx, tokenHash)
	if err == nil {
		if err := validateReplay(operation, key, digest); err != nil {
			return Result{}, err
		}
		return s.Advance(ctx, operation, "hub-api")
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Result{}, fmt.Errorf("find signup completion: %w", err)
	}

	signup, err := s.queries.FindHubSignupForCompletion(ctx, tokenHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, ErrInvalidToken
	}
	if err != nil {
		return Result{}, fmt.Errorf("find signup request: %w", err)
	}
	if !eligible(common.CountryCode(signup.ResidentCountry)) {
		return Result{}, ErrInvalidToken
	}
	passwordHash, err := credentials.HashPassword(string(request.Password))
	if err != nil {
		return Result{}, err
	}
	handle, err := hubusers.Handle(signup.DisplayName)
	if err != nil {
		return Result{}, err
	}
	now := s.now().UTC()
	did, err := dbvalue.NewUUIDv7(now)
	if err != nil {
		return Result{}, err
	}
	operationID, err := dbvalue.NewUUID()
	if err != nil {
		return Result{}, err
	}
	reserveID, err := dbvalue.NewUUID()
	if err != nil {
		return Result{}, err
	}
	activateID, err := dbvalue.NewUUID()
	if err != nil {
		return Result{}, err
	}
	plaintext, err := json.Marshal(payload{
		EmailAddress: signup.EmailAddress, DisplayName: signup.DisplayName,
		PasswordHash: passwordHash, PreferredLanguage: signup.PreferredLanguage,
		ResidentCountry: signup.ResidentCountry,
	})
	if err != nil {
		return Result{}, err
	}
	ciphertext, err := credentials.Encrypt(s.payloadKey, plaintext)
	if err != nil {
		return Result{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	if err := q.LockIdempotency(
		ctx, "hub:complete-signup:"+hex.EncodeToString(tokenHash),
	); err != nil {
		return Result{}, err
	}
	existing, err := q.GetHubSignupCompletionByTokenHash(ctx, tokenHash)
	if err == nil {
		if err := validateReplay(existing, key, digest); err != nil {
			return Result{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return Result{}, err
		}
		return s.Advance(ctx, existing, "hub-api")
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Result{}, err
	}
	accountEmailDigest := s.digestKey.HubAccountEmail(signup.EmailAddress)
	prepared, err := q.PrepareHubSignupCompletion(
		ctx, sqlc.PrepareHubSignupCompletionParams{
			HubSignupRequestID: signup.HubSignupRequestID,
			TokenHash:          tokenHash, OperationID: operationID,
			IdempotencyKey: string(key), RequestDigest: digest,
			AccountEmailDigest: accountEmailDigest,
			HubUserDid:         did, Handle: string(handle),
			ReserveCommandID: reserveID, ActivateCommandID: activateID,
			PayloadCiphertext:     ciphertext,
			ProvisioningExpiresAt: dbvalue.Timestamp(now.Add(reservationTTL)),
			ExpiresAt:             dbvalue.Timestamp(now.Add(operationTTL)),
			TenantID:              s.tenantID,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, ErrInvalidToken
	}
	if err != nil {
		return Result{}, fmt.Errorf("prepare signup completion: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Result{}, err
	}
	return s.Advance(ctx, fromPrepare(prepared), "hub-api")
}

func (s *Service) Advance(
	ctx context.Context, operation sqlc.VetchiumHubSignupCompletion,
	source string,
) (Result, error) {
	for transitions := 0; transitions < handleAttempts+3; transitions++ {
		if (operation.State == sqlc.VetchiumHubSignupCompletionStatePrepared ||
			operation.State == sqlc.VetchiumHubSignupCompletionStateReserved) &&
			!s.now().UTC().Before(operation.ProvisioningExpiresAt.Time) {
			if err := s.abandon(ctx, operation.OperationID, source); err != nil {
				return Result{}, err
			}
			return pendingResult(operation), ErrExpired
		}
		switch operation.State {
		case sqlc.VetchiumHubSignupCompletionStatePrepared:
			outcome, err := s.directory.ReserveHubPrincipal(
				ctx, directoryspec.ReserveHubPrincipalRequest{
					CommandID:             directoryspec.CommandID(dbvalue.FormatUUID(operation.ReserveCommandID)),
					HubUserDID:            hubspec.HubUserDID(dbvalue.FormatUUID(operation.HubUserDid)),
					Handle:                hubspec.HubHandle(operation.Handle),
					HomeTenantID:          directoryspec.TenantID(s.tenantID),
					ProvisioningExpiresAt: operation.ProvisioningExpiresAt.Time,
					AccountEmailDigest: directoryspec.EmailDigest(
						hex.EncodeToString(operation.AccountEmailDigest),
					),
					DigestKeyID: directoryspec.DigestKeyID(s.digestKey.ID()),
				},
			)
			if err != nil {
				return s.directoryUnreachable(ctx, operation, "reserve", err)
			}
			if outcome.Problem != nil {
				// Checked first and distinctly from the handle conflict
				// below (GU-SIG-004): the email digest is checked before the
				// handle at the coordinator, so this can never also be a
				// handle collision, and it must never be rotated through as
				// one.
				if outcome.Problem.Type == coordinatorproblem.DirectoryEmailClaimConflictError.Type {
					return s.failRegisteredElsewhere(ctx, operation)
				}
				if outcome.Problem.Type == coordinatorproblem.DirectoryClaimConflictError.Type &&
					operation.AttemptCount < handleAttempts {
					rotated, rotateErr := s.rotateHandle(ctx, operation)
					if rotateErr != nil {
						return Result{}, rotateErr
					}
					operation = rotated
					continue
				}
				return s.directoryRefused(
					ctx, operation, "reserve", outcome.Problem.Type,
				)
			}
			if err := validatePrincipal(outcome.Principal, operation, s.tenantID, directoryspec.PrincipalProvisioning); err != nil {
				return s.directoryRefused(
					ctx, operation, "reserve", "mismatched principal",
				)
			}
			operation, err = s.queries.MarkHubSignupCompletionReserved(
				ctx, sqlc.MarkHubSignupCompletionReservedParams{
					OperationID:      operation.OperationID,
					ReserveCommandID: operation.ReserveCommandID,
				},
			)
			if errors.Is(err, pgx.ErrNoRows) {
				operation, err = s.queries.GetHubSignupCompletion(ctx, operation.OperationID)
			}
			if err != nil {
				s.recordRetry(ctx, operation.OperationID, err)
				return pendingResult(operation), ErrPending
			}

		case sqlc.VetchiumHubSignupCompletionStateReserved:
			created, err := s.createLocal(ctx, operation, source)
			if errors.Is(err, pgx.ErrNoRows) {
				operation, err = s.queries.GetHubSignupCompletion(ctx, operation.OperationID)
				if err == nil &&
					operation.State == sqlc.VetchiumHubSignupCompletionStateReserved {
					return s.requestInactive(ctx, operation)
				}
			} else if err == nil {
				operation = fromCreate(created)
			}
			if err != nil {
				s.recordRetry(ctx, operation.OperationID, err)
				return pendingResult(operation), ErrPending
			}

		case sqlc.VetchiumHubSignupCompletionStateLocalCreated:
			outcome, err := s.directory.ActivateHubPrincipal(
				ctx, directoryspec.ActivateHubPrincipalRequest{
					CommandID:  directoryspec.CommandID(dbvalue.FormatUUID(operation.ActivateCommandID)),
					HubUserDID: hubspec.HubUserDID(dbvalue.FormatUUID(operation.HubUserDid)),
				},
			)
			if err != nil {
				return s.directoryUnreachable(ctx, operation, "activate", err)
			}
			if outcome.Problem != nil {
				if outcome.Problem.Type == coordinatorproblem.DirectoryStateConflictError.Type &&
					!s.now().UTC().Before(operation.ProvisioningExpiresAt.Time) {
					if err := s.abandon(ctx, operation.OperationID, source); err != nil {
						return Result{}, err
					}
					return pendingResult(operation), ErrExpired
				}
				return s.directoryRefused(
					ctx, operation, "activate", outcome.Problem.Type,
				)
			}
			if err := validatePrincipal(outcome.Principal, operation, s.tenantID, directoryspec.PrincipalActive); err != nil {
				return s.directoryRefused(
					ctx, operation, "activate", "mismatched principal",
				)
			}
			completed, err := s.queries.CompleteProvisioningHubUser(
				ctx, sqlc.CompleteProvisioningHubUserParams{
					OperationID: operation.OperationID,
					TenantID:    s.tenantID, Source: source,
				},
			)
			if errors.Is(err, pgx.ErrNoRows) {
				operation, err = s.queries.GetHubSignupCompletion(ctx, operation.OperationID)
			} else if err == nil {
				operation = fromComplete(completed)
			}
			if err != nil {
				s.recordRetry(ctx, operation.OperationID, err)
				return pendingResult(operation), ErrPending
			}

		case sqlc.VetchiumHubSignupCompletionStateCompleted:
			return completedResult(operation), nil
		case sqlc.VetchiumHubSignupCompletionStateFailed:
			// A replay of an already-failed completion (by token or by
			// idempotency key) returns the same outcome it originally
			// reached, rather than re-deriving it.
			if operation.FailureReason.Valid &&
				operation.FailureReason.String == "email_registered_elsewhere" {
				return pendingResult(operation), &ErrRegisteredElsewhere{
					HomeTenantID: operation.ConflictingHomeTenantID.String,
				}
			}
			return pendingResult(operation), ErrExpired
		default:
			return Result{}, fmt.Errorf("unknown signup completion state %q", operation.State)
		}
	}
	return Result{}, fmt.Errorf("signup completion transition limit exceeded")
}

func (s *Service) Recover(ctx context.Context) (int, error) {
	operations, err := s.queries.ListRecoverableHubSignupCompletions(ctx)
	if err != nil {
		return 0, err
	}
	completed := 0
	for _, operation := range operations {
		result, err := s.Advance(ctx, operation, "workers")
		if err != nil && !errors.Is(err, ErrPending) && !errors.Is(err, ErrExpired) {
			return completed, err
		}
		if result.Completed {
			completed++
		}
	}
	if _, err := s.queries.PruneExpiredHubSignupCompletions(ctx); err != nil {
		return completed, fmt.Errorf("prune expired signup completions: %w", err)
	}
	return completed, nil
}

// failRegisteredElsewhere handles a definite directory-email-claim-conflict:
// the address is already an active Hub account at another tenant. The
// coordinator already gave a definite answer, so this always terminates the
// completion; it never retries (GU-SIG-004).
func (s *Service) failRegisteredElsewhere(
	ctx context.Context, operation sqlc.VetchiumHubSignupCompletion,
) (Result, error) {
	homeTenantID := ""
	response, details, err := s.directory.ResolveHubAccountEmail(
		ctx, directoryspec.ResolveHubAccountEmailRequest{
			EmailDigest: directoryspec.EmailDigest(
				hex.EncodeToString(operation.AccountEmailDigest),
			),
			DigestKeyID: directoryspec.DigestKeyID(s.digestKey.ID()),
		},
	)
	if err == nil && details == nil {
		homeTenantID = string(response.HomeTenantID)
	}
	var conflictingHomeTenantID *string
	if homeTenantID != "" {
		conflictingHomeTenantID = &homeTenantID
	}
	failed, err := s.queries.FailHubSignupCompletionRegisteredElsewhere(
		ctx, sqlc.FailHubSignupCompletionRegisteredElsewhereParams{
			OperationID:             operation.OperationID,
			ConflictingHomeTenantID: dbvalue.NullText(conflictingHomeTenantID),
			TenantID:                s.tenantID,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		// Already resolved by a racing driver; re-read and let the normal
		// state switch report the same outcome on the next loop iteration.
		current, getErr := s.queries.GetHubSignupCompletion(ctx, operation.OperationID)
		if getErr != nil {
			return Result{}, fmt.Errorf(
				"reload signup completion after registered-elsewhere race: %w",
				getErr,
			)
		}
		return s.Advance(ctx, current, "hub-api")
	}
	if err != nil {
		return Result{}, fmt.Errorf(
			"fail signup completion registered elsewhere: %w", err,
		)
	}
	return pendingResult(fromFail(failed)), &ErrRegisteredElsewhere{
		HomeTenantID: homeTenantID,
	}
}

func (s *Service) abandon(
	ctx context.Context, operationID pgtype.UUID, source string,
) error {
	_, err := s.queries.AbandonExpiredHubSignupCompletion(
		ctx, sqlc.AbandonExpiredHubSignupCompletionParams{
			OperationID: operationID, TenantID: s.tenantID, Source: source,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("abandon expired signup completion: %w", err)
	}
	return nil
}

func (s *Service) createLocal(
	ctx context.Context, operation sqlc.VetchiumHubSignupCompletion,
	source string,
) (sqlc.CreateProvisioningHubUserRow, error) {
	plaintext, err := credentials.Decrypt(s.payloadKey, operation.PayloadCiphertext)
	if err != nil {
		return sqlc.CreateProvisioningHubUserRow{}, err
	}
	var data payload
	decoder := json.NewDecoder(bytes.NewReader(plaintext))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&data); err != nil {
		return sqlc.CreateProvisioningHubUserRow{}, err
	}
	return s.queries.CreateProvisioningHubUser(
		ctx, sqlc.CreateProvisioningHubUserParams{
			OperationID:  operation.OperationID,
			EmailAddress: data.EmailAddress, DisplayName: data.DisplayName,
			PasswordHash:      data.PasswordHash,
			PreferredLanguage: data.PreferredLanguage,
			ResidentCountry:   data.ResidentCountry,
			DefaultHubPlanOid: string(subscriptionspec.DefaultPlan),
			TenantID:          s.tenantID, Source: source,
		},
	)
}

func (s *Service) rotateHandle(
	ctx context.Context, operation sqlc.VetchiumHubSignupCompletion,
) (sqlc.VetchiumHubSignupCompletion, error) {
	plaintext, err := credentials.Decrypt(s.payloadKey, operation.PayloadCiphertext)
	if err != nil {
		return operation, err
	}
	var data payload
	if err := json.Unmarshal(plaintext, &data); err != nil {
		return operation, err
	}
	handle, err := hubusers.Handle(data.DisplayName)
	if err != nil {
		return operation, err
	}
	commandID, err := dbvalue.NewUUID()
	if err != nil {
		return operation, err
	}
	return s.queries.RotateHubSignupCompletionHandle(
		ctx, sqlc.RotateHubSignupCompletionHandleParams{
			Handle: string(handle), NewReserveCommandID: commandID,
			OperationID:              operation.OperationID,
			PreviousReserveCommandID: operation.ReserveCommandID,
		},
	)
}

// directoryUnreachable schedules another attempt after a directory command
// failed in transport, which is expected during a coordinator outage.
func (s *Service) directoryUnreachable(
	ctx context.Context, operation sqlc.VetchiumHubSignupCompletion,
	command string, err error,
) (Result, error) {
	s.log.WarnContext(
		ctx, "Hub signup completion directory command pending",
		"event", "hub_signup_directory_pending",
		"command", command,
		"operationID", dbvalue.FormatUUID(operation.OperationID),
		"error", err,
	)
	s.recordRetry(ctx, operation.OperationID, err)
	return pendingResult(operation), ErrPending
}

// directoryRefused schedules another attempt after the directory answered
// with something this saga has no transition for, such as a digest-key
// mismatch. That will not clear by retrying alone, so it is logged at error
// level for an operator, without the address or its digest.
func (s *Service) directoryRefused(
	ctx context.Context, operation sqlc.VetchiumHubSignupCompletion,
	command, reason string,
) (Result, error) {
	s.log.ErrorContext(
		ctx, "Hub signup completion directory command refused",
		"event", "hub_signup_directory_refused",
		"command", command,
		"operationID", dbvalue.FormatUUID(operation.OperationID),
		"reason", reason,
	)
	s.recordRetry(
		ctx, operation.OperationID,
		fmt.Errorf("%s global principal: %s", command, reason),
	)
	return pendingResult(operation), ErrPending
}

// requestInactive reports a reserved completion whose signup request is no
// longer active, so creating the user would leave that request unconsumed.
// Replacement and abandonment are built never to allow this; the completion
// retries until its reservation expires and is abandoned.
func (s *Service) requestInactive(
	ctx context.Context, operation sqlc.VetchiumHubSignupCompletion,
) (Result, error) {
	s.log.ErrorContext(
		ctx, "Hub signup completion lost its signup request",
		"event", "hub_signup_request_inactive",
		"operationID", dbvalue.FormatUUID(operation.OperationID),
	)
	s.recordRetry(
		ctx, operation.OperationID, errors.New("signup request is not active"),
	)
	return pendingResult(operation), ErrPending
}

func (s *Service) recordRetry(ctx context.Context, operationID pgtype.UUID, err error) {
	_ = s.queries.RecordHubSignupCompletionRetry(
		ctx, sqlc.RecordHubSignupCompletionRetryParams{
			OperationID: operationID, LastError: err.Error(),
		},
	)
}

func requestDigest(request hubauth.CompleteSignupRequest) ([]byte, error) {
	encoded, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(encoded)
	return digest[:], nil
}

func validateReplay(
	operation sqlc.VetchiumHubSignupCompletion,
	key common.IdempotencyKey, digest []byte,
) error {
	if operation.IdempotencyKey != string(key) {
		return ErrInvalidToken
	}
	if !bytes.Equal(operation.RequestDigest, digest) {
		return ErrIdempotencyConflict
	}
	return nil
}

func validatePrincipal(
	principal *directoryspec.PrincipalCommandResponse,
	operation sqlc.VetchiumHubSignupCompletion, tenantID string,
	state directoryspec.PrincipalState,
) error {
	if principal == nil || string(principal.HubUserDID) != dbvalue.FormatUUID(operation.HubUserDid) ||
		string(principal.Handle) != operation.Handle ||
		string(principal.HomeTenantID) != tenantID || principal.State != state {
		return fmt.Errorf("directory returned a mismatched principal")
	}
	return nil
}

func pendingResult(operation sqlc.VetchiumHubSignupCompletion) Result {
	return Result{OperationID: dbvalue.FormatUUID(operation.OperationID)}
}

func completedResult(operation sqlc.VetchiumHubSignupCompletion) Result {
	return Result{
		OperationID: dbvalue.FormatUUID(operation.OperationID), Completed: true,
		Response: hubauth.CompleteSignupResponse{
			Handle: hubspec.HubHandle(operation.Handle),
		},
	}
}

func fromPrepare(row sqlc.PrepareHubSignupCompletionRow) sqlc.VetchiumHubSignupCompletion {
	return sqlc.VetchiumHubSignupCompletion(row)
}

func fromCreate(row sqlc.CreateProvisioningHubUserRow) sqlc.VetchiumHubSignupCompletion {
	return sqlc.VetchiumHubSignupCompletion(row)
}

func fromComplete(row sqlc.CompleteProvisioningHubUserRow) sqlc.VetchiumHubSignupCompletion {
	return sqlc.VetchiumHubSignupCompletion(row)
}

func fromFail(
	row sqlc.FailHubSignupCompletionRegisteredElsewhereRow,
) sqlc.VetchiumHubSignupCompletion {
	return sqlc.VetchiumHubSignupCompletion(row)
}
