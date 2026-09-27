// Package signupcompletion coordinates the durable local/global Org signup
// saga. Admission, the domain's current owner, and the live DNS record are
// checked before the operation is prepared; after that, no database
// transaction is held across a network call.
package signupcompletion

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs"
	orgsauth "github.com/vetchium/src/typespec/orgs/auth"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/directoryclient"
	"backend/internal/dnsverify"
)

const (
	reservationTTL = 48 * time.Hour
	operationTTL   = 7 * 24 * time.Hour

	// DefaultPlan is the plan every new Org starts on in this version.
	DefaultPlan = "org-free-tier"
)

var (
	ErrInvalidToken         = errors.New("invalid signup token")
	ErrIdempotencyConflict  = errors.New("idempotency key conflict")
	ErrPending              = errors.New("signup completion pending")
	ErrExpired              = errors.New("signup completion expired")
	ErrDomainOwned          = errors.New("domain already owned")
	ErrDomainBlocked        = errors.New("domain blocked for Org signup")
	ErrRecordNotFound       = errors.New("domain verification record not found")
	ErrDirectoryUnavailable = errors.New("global directory unavailable")
)

type Directory interface {
	ResolveOrgDomain(
		context.Context, directoryspec.ResolveOrgDomainRequest,
	) (directoryspec.ResolveOrgDomainResponse, *problem.Details, error)
	ReserveOrgPrincipal(
		context.Context, directoryspec.ReserveOrgPrincipalRequest,
	) (directoryclient.OrgOutcome, error)
	ActivateOrgPrincipal(
		context.Context, directoryspec.ActivateOrgPrincipalRequest,
	) (directoryclient.OrgOutcome, error)
}

type Checker interface {
	Check(ctx context.Context, domain, token string) (dnsverify.Result, error)
}

type Service struct {
	pool          *pgxpool.Pool
	queries       *sqlc.Queries
	directory     Directory
	checker       Checker
	tenantID      string
	payloadKey    [32]byte
	checkInterval time.Duration
	now           func() time.Time
}

type payload struct {
	DisplayName       string `json:"display_name"`
	EmailAddress      string `json:"email_address"`
	PasswordHash      string `json:"password_hash"`
	PreferredLanguage string `json:"preferred_language"`
	VerificationToken string `json:"verification_token"`
}

type Result struct {
	OperationID string
	Completed   bool
	Response    orgsauth.CompleteSignupResponse
}

func New(
	pool *pgxpool.Pool, directory Directory, checker Checker, tenantID string,
	payloadKey [32]byte, checkInterval time.Duration, now func() time.Time,
) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{
		pool: pool, queries: sqlc.New(pool), directory: directory,
		checker: checker, tenantID: tenantID, payloadKey: payloadKey,
		checkInterval: checkInterval, now: now,
	}
}

func (s *Service) Start(
	ctx context.Context, request orgsauth.CompleteSignupRequest,
	key common.IdempotencyKey,
) (Result, error) {
	tokenHash := credentials.TokenHash(string(request.SignupToken))
	digest, err := requestDigest(request)
	if err != nil {
		return Result{}, err
	}
	operation, err := s.queries.GetOrgSignupCompletionByTokenHash(ctx, tokenHash)
	if err == nil {
		if err := validateReplay(operation, key, digest); err != nil {
			return Result{}, err
		}
		return s.Advance(ctx, operation, "orgs-api")
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Result{}, fmt.Errorf("find Org signup completion: %w", err)
	}

	signup, err := s.queries.FindOrgSignupForCompletion(ctx, tokenHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, ErrInvalidToken
	}
	if err != nil {
		return Result{}, fmt.Errorf("find Org signup request: %w", err)
	}
	if err := s.admit(ctx, signup.Domain); err != nil {
		return Result{}, err
	}
	result, lookupErr := s.checker.Check(
		ctx, signup.Domain, signup.VerificationToken,
	)
	if result != dnsverify.Present {
		if lookupErr != nil {
			return Result{}, fmt.Errorf("%w: %w", ErrRecordNotFound, lookupErr)
		}
		return Result{}, ErrRecordNotFound
	}

	passwordHash, err := credentials.HashPassword(string(request.Password))
	if err != nil {
		return Result{}, err
	}
	now := s.now().UTC()
	did, err := dbvalue.NewUUIDv7(now)
	if err != nil {
		return Result{}, err
	}
	ids, err := newUUIDs(3)
	if err != nil {
		return Result{}, err
	}
	plaintext, err := json.Marshal(payload{
		DisplayName:       string(request.OrgDisplayName),
		EmailAddress:      signup.EmailAddress,
		PasswordHash:      passwordHash,
		PreferredLanguage: signup.PreferredLanguage,
		VerificationToken: signup.VerificationToken,
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
		ctx, "orgs:complete-signup:"+hex.EncodeToString(tokenHash),
	); err != nil {
		return Result{}, err
	}
	existing, err := q.GetOrgSignupCompletionByTokenHash(ctx, tokenHash)
	if err == nil {
		if err := validateReplay(existing, key, digest); err != nil {
			return Result{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return Result{}, err
		}
		return s.Advance(ctx, existing, "orgs-api")
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Result{}, err
	}
	prepared, err := q.PrepareOrgSignupCompletion(
		ctx, sqlc.PrepareOrgSignupCompletionParams{
			OrgSignupRequestID: signup.OrgSignupRequestID,
			TokenHash:          tokenHash, OperationID: ids[0],
			IdempotencyKey: string(key), RequestDigest: digest,
			OrgDid: did, ReserveCommandID: ids[1], ActivateCommandID: ids[2],
			PayloadCiphertext:     ciphertext,
			ProvisioningExpiresAt: dbvalue.Timestamp(now.Add(reservationTTL)),
			ExpiresAt:             dbvalue.Timestamp(now.Add(operationTTL)),
			TenantID:              s.tenantID,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		// The request was consumed, expired, or its domain was claimed
		// locally after the checks above. Only the last is worth telling.
		if admissionErr := s.admitLocally(ctx, signup.Domain); admissionErr != nil {
			return Result{}, admissionErr
		}
		return Result{}, ErrInvalidToken
	}
	if err != nil {
		return Result{}, fmt.Errorf("prepare Org signup completion: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Result{}, err
	}
	return s.Advance(ctx, fromPrepare(prepared), "orgs-api")
}

func (s *Service) admit(ctx context.Context, domain string) error {
	if err := s.admitLocally(ctx, domain); err != nil {
		return err
	}
	_, details, err := s.directory.ResolveOrgDomain(
		ctx, directoryspec.ResolveOrgDomainRequest{
			Domain: orgs.OrgDomain(domain),
		},
	)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrDirectoryUnavailable, err)
	}
	if details == nil {
		return ErrDomainOwned
	}
	if details.Status != http.StatusNotFound {
		return fmt.Errorf("%w: %s", ErrDirectoryUnavailable, details.Type)
	}
	return nil
}

func (s *Service) admitLocally(ctx context.Context, domain string) error {
	admission, err := s.queries.CheckOrgDomainAdmission(ctx, domain)
	if err != nil {
		return fmt.Errorf("check Org domain admission: %w", err)
	}
	if admission.Blocked {
		return ErrDomainBlocked
	}
	if admission.LocallyOwned {
		return ErrDomainOwned
	}
	return nil
}

func (s *Service) Advance(
	ctx context.Context, operation sqlc.VetchiumOrgSignupCompletion,
	source string,
) (Result, error) {
	for range 4 {
		if (operation.State == sqlc.VetchiumOrgSignupCompletionStatePrepared ||
			operation.State == sqlc.VetchiumOrgSignupCompletionStateReserved) &&
			!s.now().UTC().Before(operation.ProvisioningExpiresAt.Time) {
			if err := s.abandon(ctx, operation.OperationID, source); err != nil {
				return Result{}, err
			}
			return pendingResult(operation), ErrExpired
		}
		switch operation.State {
		case sqlc.VetchiumOrgSignupCompletionStatePrepared:
			next, err := s.reserve(ctx, operation, source)
			if err != nil {
				return pendingResult(operation), err
			}
			operation = next
		case sqlc.VetchiumOrgSignupCompletionStateReserved:
			created, err := s.createLocal(ctx, operation, source)
			if errors.Is(err, pgx.ErrNoRows) {
				operation, err = s.reload(ctx, operation)
			} else if err == nil {
				operation = fromCreate(created)
			}
			if err != nil {
				s.recordRetry(ctx, operation.OperationID, err)
				return pendingResult(operation), ErrPending
			}
		case sqlc.VetchiumOrgSignupCompletionStateLocalCreated:
			next, err := s.activate(ctx, operation, source)
			if err != nil {
				return pendingResult(operation), err
			}
			operation = next
		case sqlc.VetchiumOrgSignupCompletionStateCompleted:
			return completedResult(operation), nil
		case sqlc.VetchiumOrgSignupCompletionStateFailed:
			return pendingResult(operation), failure(operation)
		default:
			return Result{}, fmt.Errorf(
				"unknown Org signup completion state %q", operation.State,
			)
		}
	}
	return Result{}, fmt.Errorf("org signup completion transition limit exceeded")
}

func (s *Service) reserve(
	ctx context.Context, operation sqlc.VetchiumOrgSignupCompletion,
	source string,
) (sqlc.VetchiumOrgSignupCompletion, error) {
	outcome, err := s.directory.ReserveOrgPrincipal(
		ctx, directoryspec.ReserveOrgPrincipalRequest{
			CommandID:             commandID(operation.ReserveCommandID),
			OrgDID:                orgDID(operation.OrgDid),
			Domain:                orgs.OrgDomain(operation.Domain),
			HomeTenantID:          directoryspec.TenantID(s.tenantID),
			ProvisioningExpiresAt: operation.ProvisioningExpiresAt.Time,
		},
	)
	if err != nil {
		s.recordRetry(ctx, operation.OperationID, err)
		return operation, ErrPending
	}
	if outcome.Problem != nil {
		if outcome.Problem.Type == coordinatorproblem.DirectoryClaimConflictError.Type {
			failed, err := s.queries.FailOrgSignupCompletionDomainOwned(
				ctx, sqlc.FailOrgSignupCompletionDomainOwnedParams{
					OperationID: operation.OperationID, TenantID: s.tenantID,
					Source: source,
				},
			)
			if err != nil {
				return operation, fmt.Errorf(
					"fail Org signup completion: %w", err,
				)
			}
			return fromFail(failed), ErrDomainOwned
		}
		err := fmt.Errorf("reserve global Org principal: %s", outcome.Problem.Type)
		s.recordRetry(ctx, operation.OperationID, err)
		return operation, ErrPending
	}
	if err := validatePrincipal(
		outcome.Org, operation, s.tenantID, directoryspec.PrincipalProvisioning,
	); err != nil {
		s.recordRetry(ctx, operation.OperationID, err)
		return operation, ErrPending
	}
	reserved, err := s.queries.MarkOrgSignupCompletionReserved(
		ctx, sqlc.MarkOrgSignupCompletionReservedParams{
			OperationID:      operation.OperationID,
			ReserveCommandID: operation.ReserveCommandID,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return s.reload(ctx, operation)
	}
	if err != nil {
		s.recordRetry(ctx, operation.OperationID, err)
		return operation, ErrPending
	}
	return reserved, nil
}

func (s *Service) activate(
	ctx context.Context, operation sqlc.VetchiumOrgSignupCompletion,
	source string,
) (sqlc.VetchiumOrgSignupCompletion, error) {
	outcome, err := s.directory.ActivateOrgPrincipal(
		ctx, directoryspec.ActivateOrgPrincipalRequest{
			CommandID: commandID(operation.ActivateCommandID),
			OrgDID:    orgDID(operation.OrgDid),
		},
	)
	if err != nil {
		s.recordRetry(ctx, operation.OperationID, err)
		return operation, ErrPending
	}
	if outcome.Problem != nil {
		if outcome.Problem.Type == coordinatorproblem.DirectoryStateConflictError.Type &&
			!s.now().UTC().Before(operation.ProvisioningExpiresAt.Time) {
			if err := s.abandon(ctx, operation.OperationID, source); err != nil {
				return operation, err
			}
			return operation, ErrExpired
		}
		err := fmt.Errorf("activate global Org principal: %s", outcome.Problem.Type)
		s.recordRetry(ctx, operation.OperationID, err)
		return operation, ErrPending
	}
	if err := validatePrincipal(
		outcome.Org, operation, s.tenantID, directoryspec.PrincipalActive,
	); err != nil {
		s.recordRetry(ctx, operation.OperationID, err)
		return operation, ErrPending
	}
	completed, err := s.queries.CompleteProvisioningOrg(
		ctx, sqlc.CompleteProvisioningOrgParams{
			OperationID: operation.OperationID, TenantID: s.tenantID,
			Source: source,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return s.reload(ctx, operation)
	}
	if err != nil {
		s.recordRetry(ctx, operation.OperationID, err)
		return operation, ErrPending
	}
	return fromComplete(completed), nil
}

func (s *Service) Recover(ctx context.Context) (int, error) {
	operations, err := s.queries.ListRecoverableOrgSignupCompletions(ctx)
	if err != nil {
		return 0, err
	}
	completed := 0
	for _, row := range operations {
		result, err := s.Advance(ctx, row, "workers")
		if err != nil && !errors.Is(err, ErrPending) &&
			!errors.Is(err, ErrExpired) && !errors.Is(err, ErrDomainOwned) {
			return completed, err
		}
		if result.Completed {
			completed++
		}
	}
	if _, err := s.queries.PruneExpiredOrgSignupCompletions(ctx); err != nil {
		return completed, fmt.Errorf("prune expired Org signup completions: %w", err)
	}
	return completed, nil
}

func (s *Service) reload(
	ctx context.Context, operation sqlc.VetchiumOrgSignupCompletion,
) (sqlc.VetchiumOrgSignupCompletion, error) {
	row, err := s.queries.GetOrgSignupCompletion(ctx, operation.OperationID)
	if err != nil {
		return operation, err
	}
	return row, nil
}

func (s *Service) abandon(
	ctx context.Context, operationID pgtype.UUID, source string,
) error {
	_, err := s.queries.AbandonExpiredOrgSignupCompletion(
		ctx, sqlc.AbandonExpiredOrgSignupCompletionParams{
			OperationID: operationID, TenantID: s.tenantID, Source: source,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("abandon expired Org signup completion: %w", err)
	}
	return nil
}

func (s *Service) createLocal(
	ctx context.Context, operation sqlc.VetchiumOrgSignupCompletion,
	source string,
) (sqlc.CreateProvisioningOrgRow, error) {
	plaintext, err := credentials.Decrypt(s.payloadKey, operation.PayloadCiphertext)
	if err != nil {
		return sqlc.CreateProvisioningOrgRow{}, err
	}
	var data payload
	decoder := json.NewDecoder(bytes.NewReader(plaintext))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&data); err != nil {
		return sqlc.CreateProvisioningOrgRow{}, err
	}
	return s.queries.CreateProvisioningOrg(
		ctx, sqlc.CreateProvisioningOrgParams{
			OperationID: operation.OperationID, DisplayName: data.DisplayName,
			OrgPlanOid:        DefaultPlan,
			VerificationToken: data.VerificationToken,
			NextCheckAt: dbvalue.Timestamp(
				s.now().UTC().Add(s.checkInterval),
			),
			EmailAddress:      data.EmailAddress,
			PreferredLanguage: data.PreferredLanguage,
			PasswordHash:      data.PasswordHash,
			TenantID:          s.tenantID, Source: source,
		},
	)
}

func (s *Service) recordRetry(
	ctx context.Context, operationID pgtype.UUID, err error,
) {
	_ = s.queries.RecordOrgSignupCompletionRetry(
		ctx, sqlc.RecordOrgSignupCompletionRetryParams{
			OperationID: operationID, LastError: err.Error(),
		},
	)
}

func requestDigest(request orgsauth.CompleteSignupRequest) ([]byte, error) {
	encoded, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(encoded)
	return digest[:], nil
}

func validateReplay(
	operation sqlc.VetchiumOrgSignupCompletion,
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
	principal *directoryspec.OrgPrincipalCommandResponse,
	operation sqlc.VetchiumOrgSignupCompletion, tenantID string,
	state directoryspec.PrincipalState,
) error {
	if principal == nil ||
		string(principal.OrgDID) != dbvalue.FormatUUID(operation.OrgDid) ||
		principal.Domain == nil ||
		string(*principal.Domain) != operation.Domain ||
		string(principal.HomeTenantID) != tenantID || principal.State != state {
		return fmt.Errorf("directory returned a mismatched Org principal")
	}
	return nil
}

func failure(operation sqlc.VetchiumOrgSignupCompletion) error {
	if operation.FailureReason.Valid &&
		operation.FailureReason.String == "domain_owned" {
		return ErrDomainOwned
	}
	return ErrExpired
}

func newUUIDs(count int) ([]pgtype.UUID, error) {
	ids := make([]pgtype.UUID, count)
	for index := range ids {
		id, err := dbvalue.NewUUID()
		if err != nil {
			return nil, err
		}
		ids[index] = id
	}
	return ids, nil
}

func commandID(id pgtype.UUID) directoryspec.CommandID {
	return directoryspec.CommandID(dbvalue.FormatUUID(id))
}

func orgDID(id pgtype.UUID) orgs.OrgDID {
	return orgs.OrgDID(dbvalue.FormatUUID(id))
}

func pendingResult(operation sqlc.VetchiumOrgSignupCompletion) Result {
	return Result{OperationID: dbvalue.FormatUUID(operation.OperationID)}
}

func completedResult(operation sqlc.VetchiumOrgSignupCompletion) Result {
	return Result{
		OperationID: dbvalue.FormatUUID(operation.OperationID), Completed: true,
		Response: orgsauth.CompleteSignupResponse{
			Domain: orgs.OrgDomain(operation.Domain),
		},
	}
}

func fromPrepare(
	row sqlc.PrepareOrgSignupCompletionRow,
) sqlc.VetchiumOrgSignupCompletion {
	return sqlc.VetchiumOrgSignupCompletion(row)
}

func fromFail(
	row sqlc.FailOrgSignupCompletionDomainOwnedRow,
) sqlc.VetchiumOrgSignupCompletion {
	return sqlc.VetchiumOrgSignupCompletion(row)
}

func fromCreate(
	row sqlc.CreateProvisioningOrgRow,
) sqlc.VetchiumOrgSignupCompletion {
	return sqlc.VetchiumOrgSignupCompletion(row)
}

func fromComplete(
	row sqlc.CompleteProvisioningOrgRow,
) sqlc.VetchiumOrgSignupCompletion {
	return sqlc.VetchiumOrgSignupCompletion(row)
}
