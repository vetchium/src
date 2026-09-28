// Package professionalemail drives the durable global claim for a verified
// Hub professional (work) email address (GU-PEM), and the two housekeeping
// jobs that keep a tenant's local rows honest against the global directory:
// the supersession feed sync (GU-PEM-006) and the holdings sweep
// (GU-PEM-009). No database transaction is held across a network call.
package professionalemail

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/directoryclient"
)

const (
	operationTTL          = 7 * 24 * time.Hour
	supersessionFeedName  = "hub-professional-email-supersessions"
	maxSupersessionBatch  = 500
	maxHoldingsSweepBatch = 500
	maxRecoveryBatch      = 100
)

var (
	// ErrPending reports that Advance could not reach a terminal state
	// within this call; the caller returns 202 and the operation id.
	ErrPending = errors.New("professional email claim pending")
	// ErrIdempotencyConflict reports the same idempotency key reused with a
	// different verify request.
	ErrIdempotencyConflict = errors.New("idempotency key conflict")
	// ErrCodeRejected reports an unknown, expired, or already-consumed
	// challenge, or a wrong code past its final attempt.
	ErrCodeRejected = errors.New("professional email code rejected")
)

type Directory interface {
	ClaimHubProfessionalEmail(
		context.Context, directoryspec.ClaimHubProfessionalEmailRequest,
	) (directoryclient.ProfessionalClaimOutcome, error)
	ReleaseHubProfessionalEmail(
		context.Context, directoryspec.ReleaseHubProfessionalEmailRequest,
	) (directoryclient.ProfessionalReleaseOutcome, error)
	PullHubProfessionalEmailSupersessions(
		context.Context, directoryspec.PullHubProfessionalEmailSupersessionsRequest,
	) (directoryspec.PullHubProfessionalEmailSupersessionsResponse, *problem.Details, error)
	CheckHubProfessionalEmailHoldings(
		context.Context, directoryspec.CheckHubProfessionalEmailHoldingsRequest,
	) (directoryspec.CheckHubProfessionalEmailHoldingsResponse, *problem.Details, error)
}

// Digester is satisfied structurally by identitydigest.Key. This package
// never imports backend/internal/identitydigest directly: it is reachable
// from backend/internal/routes (hub_routes.go), which global-coordinator and
// mesh-api also import for their own unrelated routes, and identitydigest
// must never be linked into those binaries (GU-KEY-002). Only
// backend/cmd/hub-api and backend/cmd/workers construct the concrete key and
// pass it in here.
type Digester interface {
	HubProfessionalEmail(address string) []byte
	ID() string
}

type Service struct {
	pool      *pgxpool.Pool
	queries   *sqlc.Queries
	directory Directory
	tenantID  string
	codeKey   [32]byte
	digestKey Digester
	now       func() time.Time
}

type Result struct {
	OperationID string
	Completed   bool
}

func New(
	pool *pgxpool.Pool, directory Directory, tenantID string, codeKey [32]byte,
	digestKey Digester, now func() time.Time,
) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{
		pool: pool, queries: sqlc.New(pool), directory: directory,
		tenantID: tenantID, codeKey: codeKey, digestKey: digestKey, now: now,
	}
}

// CodeHash lets the request-code handler hash the code with the same key
// Confirm will verify it against.
func (s *Service) CodeHash(challengeID pgtype.UUID, code string) []byte {
	return credentials.VerificationCodeHash(
		s.codeKey, dbvalue.FormatUUID(challengeID), code,
	)
}

type claimPayload struct {
	HubUserDID          hubspec.HubUserDID `json:"hub_user_did"`
	ProfessionalEmailID string             `json:"professional_email_id"`
	EmailDigest         string             `json:"email_digest"`
}

type releasePayload struct {
	HubUserDID    hubspec.HubUserDID `json:"hub_user_did"`
	EmailDigest   string             `json:"email_digest"`
	ClaimRevision int64              `json:"claim_revision"`
}

// Start accepts a verify-professional-email-code request, or replays one
// already accepted under the same idempotency key, then drives it
// (GU-PEM-002, GU-PEM-003).
func (s *Service) Start(
	ctx context.Context, hubUserDID, professionalEmailID pgtype.UUID,
	request profilespec.VerifyProfessionalEmailRequest, key common.IdempotencyKey,
) (Result, error) {
	aggregateID := dbvalue.FormatUUID(professionalEmailID)
	digest := requestDigest(request)

	existing, err := s.queries.GetFederationOperationByIdempotency(
		ctx, sqlc.GetFederationOperationByIdempotencyParams{
			Kind: "hub-professional-email-claim", AggregateID: aggregateID,
			IdempotencyKey: string(key),
		},
	)
	if err == nil {
		if !bytes.Equal(existing.RequestDigest, digest) {
			return Result{}, ErrIdempotencyConflict
		}
		return s.Advance(ctx, existing, "hub-api")
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Result{}, fmt.Errorf(
			"find Hub professional email claim by idempotency: %w", err,
		)
	}

	challengeID, err := dbvalue.ParseUUID(string(request.ChallengeID))
	if err != nil {
		return Result{}, ErrCodeRejected
	}
	emailDigest, err := s.queries.GetHubProfessionalEmailChallengeDigest(
		ctx, sqlc.GetHubProfessionalEmailChallengeDigestParams{
			ChallengeID: challengeID, ProfessionalEmailID: professionalEmailID,
			HubUserDid: hubUserDID,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, ErrCodeRejected
	}
	if err != nil {
		return Result{}, fmt.Errorf(
			"read Hub professional email challenge digest: %w", err,
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
	now := s.now().UTC()
	payloadBytes, err := json.Marshal(claimPayload{
		HubUserDID:          hubspec.HubUserDID(dbvalue.FormatUUID(hubUserDID)),
		ProfessionalEmailID: aggregateID,
		EmailDigest:         hex.EncodeToString(emailDigest),
	})
	if err != nil {
		return Result{}, err
	}

	result, err := s.queries.VerifyHubProfessionalEmailChallenge(
		ctx, sqlc.VerifyHubProfessionalEmailChallengeParams{
			ChallengeID: challengeID, ProfessionalEmailID: professionalEmailID,
			HubUserDid:  hubUserDID,
			CodeHash:    s.CodeHash(challengeID, request.Code),
			OperationID: operationID, CommandID: commandID,
			IdempotencyKey: string(key), RequestDigest: digest,
			PayloadBytes:       payloadBytes,
			OperationExpiresAt: dbvalue.Timestamp(now.Add(operationTTL)),
			TenantID:           s.tenantID,
		},
	)
	if isClaimInProgress(err) {
		operation, getErr := s.queries.GetPendingHubProfessionalEmailClaimOperation(
			ctx, aggregateID,
		)
		if getErr != nil {
			return Result{}, fmt.Errorf(
				"reload pending Hub professional email claim: %w", getErr,
			)
		}
		return s.Advance(ctx, operation, "hub-api")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, ErrCodeRejected
	}
	if err != nil {
		return Result{}, fmt.Errorf(
			"verify Hub professional email challenge: %w", err,
		)
	}
	if !result.Verified {
		return Result{}, ErrCodeRejected
	}
	operation, err := s.queries.GetFederationOperation(ctx, result.OperationID)
	if err != nil {
		return Result{}, fmt.Errorf(
			"reload accepted Hub professional email claim: %w", err,
		)
	}
	return s.Advance(ctx, operation, "hub-api")
}

// Advance drives operation through the coordinator call its kind requires
// and, for a claim, the local apply (GU-PEM-003). It returns once the
// operation reaches a terminal state or a step could not complete.
func (s *Service) Advance(
	ctx context.Context, operation sqlc.VetchiumFederationOperation, source string,
) (Result, error) {
	switch operation.State {
	case sqlc.VetchiumFederationOperationStateSucceeded:
		return completedResult(operation), nil
	case sqlc.VetchiumFederationOperationStateFailed:
		return completedResult(operation), nil
	case sqlc.VetchiumFederationOperationStatePending:
		switch operation.Kind {
		case "hub-professional-email-claim":
			return s.advanceClaim(ctx, operation, source)
		case "hub-professional-email-release":
			return s.advanceRelease(ctx, operation, source)
		default:
			return Result{}, fmt.Errorf(
				"unknown Hub professional email operation kind %q", operation.Kind,
			)
		}
	default:
		return Result{}, fmt.Errorf(
			"unknown federation operation state %q", operation.State,
		)
	}
}

func (s *Service) advanceClaim(
	ctx context.Context, operation sqlc.VetchiumFederationOperation, source string,
) (Result, error) {
	var payload claimPayload
	if err := json.Unmarshal(operation.PayloadBytes, &payload); err != nil {
		return Result{}, fmt.Errorf(
			"decode Hub professional email claim payload: %w", err,
		)
	}
	professionalEmailID, err := dbvalue.ParseUUID(payload.ProfessionalEmailID)
	if err != nil {
		return Result{}, err
	}
	hubUserDID, err := dbvalue.ParseUUID(string(payload.HubUserDID))
	if err != nil {
		return Result{}, err
	}
	digest, err := hex.DecodeString(payload.EmailDigest)
	if err != nil {
		return Result{}, err
	}

	outcome, err := s.directory.ClaimHubProfessionalEmail(
		ctx, directoryspec.ClaimHubProfessionalEmailRequest{
			CommandID: directoryspec.CommandID(
				dbvalue.FormatUUID(operation.CommandID),
			),
			HubUserDID:  payload.HubUserDID,
			EmailDigest: directoryspec.EmailDigest(payload.EmailDigest),
			DigestKeyID: directoryspec.DigestKeyID(s.digestKey.ID()),
		},
	)
	if err != nil || outcome.Problem != nil || outcome.Claim == nil {
		s.recordRetry(ctx, operation.OperationID, claimAttemptError(err, outcome))
		return pendingResult(operation), ErrPending
	}
	claim := outcome.Claim

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)

	locked, err := q.LockHubProfessionalEmailForClaim(
		ctx, sqlc.LockHubProfessionalEmailForClaimParams{
			ProfessionalEmailID: professionalEmailID, HubUserDid: hubUserDID,
		},
	)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// GU-PEM-003 case 3: the row was deleted meanwhile. Compensate by
		// releasing the claim the coordinator just granted.
		if err := s.enqueueRelease(
			ctx, q, professionalEmailID, hubUserDID, digest, claim.ClaimRevision,
		); err != nil {
			return Result{}, err
		}
	case err != nil:
		return Result{}, fmt.Errorf(
			"lock Hub professional email for claim: %w", err,
		)
	case claim.ClaimRevision > max(int8OrZero(locked.ClaimRevision), locked.SupersededRevision):
		// GU-PEM-003 case 1.
		if _, err := q.MarkHubProfessionalEmailVerified(
			ctx, sqlc.MarkHubProfessionalEmailVerifiedParams{
				TenantID: s.tenantID, Source: source,
				IdempotencyKey: dbvalue.Text(
					dbvalue.FormatUUID(operation.OperationID),
				),
				ClaimRevision:       dbvalue.Int64(claim.ClaimRevision),
				ProfessionalEmailID: professionalEmailID, HubUserDid: hubUserDID,
			},
		); err != nil {
			return Result{}, fmt.Errorf(
				"mark Hub professional email verified: %w", err,
			)
		}
		if claim.SupersededSameTenantHubUserDID != nil {
			previous, err := dbvalue.ParseUUID(
				string(*claim.SupersededSameTenantHubUserDID),
			)
			if err != nil {
				return Result{}, err
			}
			if err := s.applySupersession(
				ctx, q, previous, digest, claim.ClaimRevision, source,
				dbvalue.FormatUUID(operation.OperationID),
			); err != nil {
				return Result{}, err
			}
		}
	default:
		// GU-PEM-003 case 2: a newer proof already won.
		if err := q.AuditHubProfessionalEmailClaimOutdated(
			ctx, sqlc.AuditHubProfessionalEmailClaimOutdatedParams{
				TenantID: s.tenantID, ProfessionalEmailID: dbvalue.FormatUUID(
					professionalEmailID,
				),
				HubUserDid: dbvalue.FormatUUID(hubUserDID), Source: source,
				IdempotencyKey: dbvalue.Text(
					dbvalue.FormatUUID(operation.OperationID),
				),
			},
		); err != nil {
			return Result{}, fmt.Errorf(
				"audit Hub professional email claim outdated: %w", err,
			)
		}
	}

	if err := s.resolveSucceeded(ctx, q, operation.OperationID); err != nil {
		return Result{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Result{}, err
	}
	return completedResult(operation), nil
}

func (s *Service) advanceRelease(
	ctx context.Context, operation sqlc.VetchiumFederationOperation, source string,
) (Result, error) {
	var payload releasePayload
	if err := json.Unmarshal(operation.PayloadBytes, &payload); err != nil {
		return Result{}, fmt.Errorf(
			"decode Hub professional email release payload: %w", err,
		)
	}
	outcome, err := s.directory.ReleaseHubProfessionalEmail(
		ctx, directoryspec.ReleaseHubProfessionalEmailRequest{
			CommandID: directoryspec.CommandID(
				dbvalue.FormatUUID(operation.CommandID),
			),
			HubUserDID:    payload.HubUserDID,
			EmailDigest:   directoryspec.EmailDigest(payload.EmailDigest),
			ClaimRevision: payload.ClaimRevision,
		},
	)
	if err != nil || outcome.Problem != nil {
		s.recordRetry(ctx, operation.OperationID, releaseAttemptError(err, outcome))
		return pendingResult(operation), ErrPending
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	if err := s.resolveSucceeded(ctx, q, operation.OperationID); err != nil {
		return Result{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Result{}, err
	}
	return completedResult(operation), nil
}

// enqueueRelease compensates for a claim the coordinator granted to a row
// that no longer exists locally (GU-PEM-003 case 3), addressed by the same
// professional_email_id GU-PEM-005's delete-time release uses, even though
// the row itself is gone.
func (s *Service) enqueueRelease(
	ctx context.Context, q *sqlc.Queries, professionalEmailID, hubUserDID pgtype.UUID,
	digest []byte, claimRevision int64,
) error {
	operationID, err := dbvalue.NewUUID()
	if err != nil {
		return err
	}
	commandID, err := dbvalue.NewUUID()
	if err != nil {
		return err
	}
	payload, err := json.Marshal(releasePayload{
		HubUserDID:    hubspec.HubUserDID(dbvalue.FormatUUID(hubUserDID)),
		EmailDigest:   hex.EncodeToString(digest),
		ClaimRevision: claimRevision,
	})
	if err != nil {
		return err
	}
	digestSum := sha256.Sum256(payload)
	if _, err := q.EnqueueHubProfessionalEmailReleaseOperation(
		ctx, sqlc.EnqueueHubProfessionalEmailReleaseOperationParams{
			OperationID: operationID, CommandID: commandID,
			AggregateID:    dbvalue.FormatUUID(professionalEmailID),
			HubUserDid:     dbvalue.FormatUUID(hubUserDID),
			IdempotencyKey: dbvalue.FormatUUID(operationID),
			RequestDigest:  digestSum[:], PayloadBytes: payload,
			ExpiresAt: dbvalue.Timestamp(s.now().UTC().Add(operationTTL)),
		},
	); err != nil {
		return fmt.Errorf(
			"enqueue Hub professional email release operation: %w", err,
		)
	}
	return nil
}

// applySupersession sets superseded_revision unconditionally and
// superseded_at the first time claim_revision is fenced by it, then audits
// only when superseded_at is newly set (GU-PEM-006). Shared by the
// same-tenant transfer step in advanceClaim, the supersession feed sync,
// and the holdings sweep repair.
func (s *Service) applySupersession(
	ctx context.Context, q *sqlc.Queries, hubUserDID pgtype.UUID, digest []byte,
	supersededByRevision int64, source, idempotencyKey string,
) error {
	locked, err := q.LockHubProfessionalEmailForSupersede(
		ctx, sqlc.LockHubProfessionalEmailForSupersedeParams{
			HubUserDid: hubUserDID, EmailDigest: digest,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("lock Hub professional email for supersede: %w", err)
	}

	wasSuperseded := locked.SupersededAt.Valid
	newSupersededAt := locked.SupersededAt
	if !wasSuperseded && locked.ClaimRevision.Valid &&
		locked.ClaimRevision.Int64 <= supersededByRevision {
		newSupersededAt = dbvalue.Timestamp(s.now().UTC())
	}
	if _, err := q.ApplyHubProfessionalEmailSupersession(
		ctx, sqlc.ApplyHubProfessionalEmailSupersessionParams{
			SupersededByRevision: supersededByRevision,
			SupersededAt:         newSupersededAt,
			ProfessionalEmailID:  locked.ProfessionalEmailID,
		},
	); err != nil {
		return fmt.Errorf("apply Hub professional email supersession: %w", err)
	}
	if !wasSuperseded && newSupersededAt.Valid {
		if err := q.AuditHubProfessionalEmailSuperseded(
			ctx, sqlc.AuditHubProfessionalEmailSupersededParams{
				TenantID: s.tenantID, ProfessionalEmailID: dbvalue.FormatUUID(
					locked.ProfessionalEmailID,
				),
				Source: source, IdempotencyKey: dbvalue.Text(idempotencyKey),
			},
		); err != nil {
			return fmt.Errorf(
				"audit Hub professional email superseded: %w", err,
			)
		}
	}
	return nil
}

func (s *Service) applySupersessionOwnTx(
	ctx context.Context, hubUserDID pgtype.UUID, digest []byte,
	supersededByRevision int64, source, idempotencyKey string,
) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	if err := s.applySupersession(
		ctx, q, hubUserDID, digest, supersededByRevision, source, idempotencyKey,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) resolveSucceeded(
	ctx context.Context, q *sqlc.Queries, operationID pgtype.UUID,
) error {
	if _, err := q.ResolveFederationOperation(
		ctx, sqlc.ResolveFederationOperationParams{
			OperationID: operationID,
			State:       sqlc.VetchiumFederationOperationStateSucceeded,
			ResponseStatus: pgtype.Int4{
				Int32: 204, Valid: true,
			},
			ResponseCiphertext: []byte{},
		},
	); err != nil {
		return fmt.Errorf(
			"resolve Hub professional email operation: %w", err,
		)
	}
	return nil
}

func (s *Service) recordRetry(ctx context.Context, operationID pgtype.UUID, err error) {
	_, _ = s.queries.RecordFederationOperationRetry(
		ctx, sqlc.RecordFederationOperationRetryParams{
			OperationID: operationID, LastError: err.Error(),
		},
	)
}

// Recover drives every recoverable claim or release operation once, for the
// periodic worker.
func (s *Service) Recover(ctx context.Context) (int, error) {
	operations, err := s.queries.ListRecoverableHubProfessionalEmailOperations(
		ctx, maxRecoveryBatch,
	)
	if err != nil {
		return 0, fmt.Errorf(
			"list recoverable Hub professional email operations: %w", err,
		)
	}
	completed := 0
	for _, operation := range operations {
		result, err := s.Advance(ctx, operation, "workers")
		if err != nil && !errors.Is(err, ErrPending) {
			return completed, err
		}
		if result.Completed {
			completed++
		}
	}
	return completed, nil
}

// SyncSupersessions pulls one batch from the coordinator's supersession
// feed (GU-DIR-009), applies each item, and advances the local watermark
// (GU-PEM-006). It reports whether the coordinator's acknowledgment jumped
// ahead of what this tenant had locally recorded, which means a gap: some
// supersession may have been deleted server-side before this tenant ever
// saw it, most likely from a lost local watermark write. The caller should
// run a holdings sweep immediately when GapDetected is true. StalePending
// reports the oldest still-pending item's age when it exceeds one hour, so
// the caller can log a warning without a second pull.
type SyncResult struct {
	GapDetected  bool
	StalePending time.Duration
}

const supersessionStalenessWarning = time.Hour

func (s *Service) SyncSupersessions(ctx context.Context) (SyncResult, error) {
	watermark, err := s.queries.GetGlobalFeedWatermark(ctx, supersessionFeedName)
	if errors.Is(err, pgx.ErrNoRows) {
		watermark = 0
	} else if err != nil {
		return SyncResult{}, fmt.Errorf(
			"read Hub professional email supersession watermark: %w", err,
		)
	}

	resp, details, err := s.directory.PullHubProfessionalEmailSupersessions(
		ctx, directoryspec.PullHubProfessionalEmailSupersessionsRequest{
			AcknowledgedSeq: watermark, Limit: maxSupersessionBatch,
		},
	)
	if err != nil {
		return SyncResult{}, fmt.Errorf(
			"pull Hub professional email supersessions: %w", err,
		)
	}
	if details != nil {
		return SyncResult{}, fmt.Errorf(
			"pull Hub professional email supersessions: %s", details.Type,
		)
	}

	result := SyncResult{GapDetected: resp.AcknowledgedSeq > watermark}
	if resp.OldestPendingCreatedAt != nil {
		if age := s.now().Sub(*resp.OldestPendingCreatedAt); age > supersessionStalenessWarning {
			result.StalePending = age
		}
	}
	newWatermark := max(watermark, resp.AcknowledgedSeq)
	for _, item := range resp.Supersessions {
		hubUserDID, err := dbvalue.ParseUUID(string(item.HubUserDID))
		if err != nil {
			return result, err
		}
		digest, err := hex.DecodeString(string(item.EmailDigest))
		if err != nil {
			return result, err
		}
		key := dbvalue.FormatUUID(hubUserDID) + ":" +
			strconv.FormatInt(item.SupersessionSeq, 10)
		if err := s.applySupersessionOwnTx(
			ctx, hubUserDID, digest, item.SupersededByRevision, "workers", key,
		); err != nil {
			return result, err
		}
		newWatermark = max(newWatermark, item.SupersessionSeq)
	}
	if newWatermark != watermark {
		if err := s.queries.SetGlobalFeedWatermark(
			ctx, sqlc.SetGlobalFeedWatermarkParams{
				Feed: supersessionFeedName, LastSeq: newWatermark,
			},
		); err != nil {
			return result, fmt.Errorf(
				"advance Hub professional email supersession watermark: %w", err,
			)
		}
	}
	return result, nil
}

// SweepHoldings pages through this tenant's currently-verified professional
// email rows and repairs any that the coordinator no longer agrees this
// tenant's user holds (GU-PEM-009).
func (s *Service) SweepHoldings(ctx context.Context) error {
	var after pgtype.UUID
	for {
		rows, err := s.queries.ListVerifiedHubProfessionalEmailsForHoldingsSweep(
			ctx, sqlc.ListVerifiedHubProfessionalEmailsForHoldingsSweepParams{
				AfterProfessionalEmailID: after, RowLimit: maxHoldingsSweepBatch,
			},
		)
		if err != nil {
			return fmt.Errorf(
				"list Hub professional emails for holdings sweep: %w", err,
			)
		}
		if len(rows) == 0 {
			return nil
		}

		items := make(
			[]directoryspec.HubProfessionalEmailHoldingQuery, len(rows),
		)
		for i, row := range rows {
			items[i] = directoryspec.HubProfessionalEmailHoldingQuery{
				HubUserDID: hubspec.HubUserDID(
					dbvalue.FormatUUID(row.HubUserDid),
				),
				EmailDigest: directoryspec.EmailDigest(
					hex.EncodeToString(row.EmailDigest),
				),
			}
		}
		resp, details, err := s.directory.CheckHubProfessionalEmailHoldings(
			ctx, directoryspec.CheckHubProfessionalEmailHoldingsRequest{
				Items: items,
			},
		)
		if err != nil {
			return fmt.Errorf(
				"check Hub professional email holdings: %w", err,
			)
		}
		if details != nil {
			return fmt.Errorf(
				"check Hub professional email holdings: %s", details.Type,
			)
		}
		if len(resp.Results) != len(rows) {
			return fmt.Errorf("Hub professional email holdings result count mismatch")
		}

		for i, result := range resp.Results {
			row := rows[i]
			localRevision := int8OrZero(row.ClaimRevision)
			held := result.HeldByRequestedUser && result.ClaimRevision != nil &&
				*result.ClaimRevision >= localRevision
			if held {
				continue
			}
			revision := localRevision
			if result.ClaimRevision != nil {
				revision = *result.ClaimRevision
			}
			key := dbvalue.FormatUUID(row.ProfessionalEmailID) + ":sweep"
			if err := s.applySupersessionOwnTx(
				ctx, row.HubUserDid, row.EmailDigest, revision, "workers", key,
			); err != nil {
				return err
			}
		}
		after = rows[len(rows)-1].ProfessionalEmailID
		if len(rows) < maxHoldingsSweepBatch {
			return nil
		}
	}
}

func pendingResult(operation sqlc.VetchiumFederationOperation) Result {
	return Result{OperationID: dbvalue.FormatUUID(operation.OperationID)}
}

func completedResult(operation sqlc.VetchiumFederationOperation) Result {
	return Result{
		OperationID: dbvalue.FormatUUID(operation.OperationID), Completed: true,
	}
}

func int8OrZero(value pgtype.Int8) int64 {
	if !value.Valid {
		return 0
	}
	return value.Int64
}

func claimAttemptError(
	err error, outcome directoryclient.ProfessionalClaimOutcome,
) error {
	if err != nil {
		return err
	}
	if outcome.Problem != nil {
		return fmt.Errorf("claim Hub professional email: %s", outcome.Problem.Type)
	}
	return errors.New("claim Hub professional email: empty response")
}

func releaseAttemptError(
	err error, outcome directoryclient.ProfessionalReleaseOutcome,
) error {
	if err != nil {
		return err
	}
	return fmt.Errorf(
		"release Hub professional email: %s", outcome.Problem.Type,
	)
}

func isClaimInProgress(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) &&
		databaseError.Code == "23505" &&
		databaseError.ConstraintName == "hub_professional_email_claims_one_live"
}

func requestDigest(request profilespec.VerifyProfessionalEmailRequest) []byte {
	encoded, _ := json.Marshal(request)
	digest := sha256.Sum256(encoded)
	return digest[:]
}
