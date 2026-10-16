package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	aispec "github.com/vetchium/src/typespec/orgs/ai"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/aicredits"
	"backend/internal/apiserver"
	"backend/internal/appconfig"
	"backend/internal/chatmodel"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	orgai "backend/internal/orgs/ai"
)

const draftOperation = "orgs:draft-opening-with-ai"

// settleTimeout bounds the closing transaction, which runs even after the
// client has gone so a finished call is never left reserved.
const settleTimeout = 15 * time.Second

// reservation is what the first transaction hands to the model call.
type reservation struct {
	usageID  pgtype.UUID
	reserved int64
	model    appconfig.AIModel
	messages []chatmodel.Message
}

// DraftOpeningWithAI reserves credits, calls the model with no transaction
// open, then settles a usable answer or releases the reservation.
//
//vetchium:multiple-commits reserves credits, calls the model outside a transaction, then settles them
func DraftOpeningWithAI(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request aispec.DraftOpeningRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		if s.AI == nil {
			s.Problem(r.Context(), w, orgsproblem.AIUnavailableError)
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		encoded, err := json.Marshal(request)
		if err != nil {
			s.InternalError(r.Context(), w, "encode AI draft request", err)
			return
		}
		digest := sha256.Sum256(encoded)
		held, replay, apiProblem, err := reserveDraft(
			r.Context(), s, identity, key, digest, request,
		)
		switch {
		case err != nil:
			s.InternalError(r.Context(), w, "reserve AI draft", err)
			return
		case apiProblem != nil:
			s.Problem(r.Context(), w, apiProblem)
			return
		case replay != nil:
			w.Header().Set("Cache-Control", "no-store")
			s.JSON(r.Context(), w, http.StatusOK, *replay)
			return
		}

		callCtx, cancel := context.WithTimeout(
			r.Context(), s.AI.Config.RequestTimeout,
		)
		answer, callErr := s.AI.Client.Complete(callCtx, s.AI.Endpoint(held.model),
			chatmodel.Request{
				Messages:   held.messages,
				MaxTokens:  draftMaxTokens(held.model),
				JSONSchema: orgai.OpeningDraftSchema(),
			})
		cancel()

		closeCtx, cancelClose := context.WithTimeout(
			context.WithoutCancel(r.Context()), settleTimeout,
		)
		defer cancelClose()
		if callErr != nil {
			s.Log(r.Context(), slog.LevelWarn, "AI model call failed",
				"event", "org_ai_model_failed",
				"model_oid", held.model.OID, "error", callErr)
			if err := releaseDraft(closeCtx, s, identity, key, held,
				sqlc.VetchiumOrgAiFailureReasonModelFailed, nil); err != nil {
				s.InternalError(r.Context(), w, "release AI draft", err)
				return
			}
			s.Problem(r.Context(), w, orgsproblem.AIModelFailedError)
			return
		}
		content, dropped, usable := orgai.ParseOpeningDraft(answer.Content)
		if !usable {
			if err := releaseDraft(closeCtx, s, identity, key, held,
				sqlc.VetchiumOrgAiFailureReasonUnusableOutput, &answer); err != nil {
				s.InternalError(r.Context(), w, "release AI draft", err)
				return
			}
			s.Problem(r.Context(), w, orgsproblem.AIOutputUnusableError)
			return
		}
		body, apiProblem, err := settleDraft(
			closeCtx, s, identity, key, held, answer, content, dropped,
		)
		switch {
		case err != nil:
			s.InternalError(r.Context(), w, "settle AI draft", err)
		case apiProblem != nil:
			s.Problem(r.Context(), w, apiProblem)
		default:
			w.Header().Set("Cache-Control", "no-store")
			s.JSON(r.Context(), w, http.StatusOK, body)
		}
	}
}

func draftMaxTokens(model appconfig.AIModel) int {
	return min(orgai.DraftMaxOutputTokens, model.MaxOutputTokens)
}

func draftLock(identity middleware.OrgIdentity, key common.IdempotencyKey) string {
	return draftOperation + ":" + dbvalue.FormatUUID(identity.UserID) + ":" + string(key)
}

func draftLookup(
	identity middleware.OrgIdentity, key common.IdempotencyKey,
) sqlc.GetIdempotencyParams {
	return sqlc.GetIdempotencyParams{
		Operation: draftOperation, BindingID: dbvalue.FormatUUID(identity.UserID),
		IdempotencyKey: string(key),
	}
}

// reserveDraft replays a completed request, or checks every precondition and
// holds the worst-case cost. A refusal rolls back, taking the new idempotency
// record with it, as for every other idempotent operation.
func reserveDraft(
	ctx context.Context, s *orgsruntime.Server, identity middleware.OrgIdentity,
	key common.IdempotencyKey, digest [32]byte, request aispec.DraftOpeningRequest,
) (reservation, *aispec.DraftOpeningResponse, problem.Body, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return reservation{}, nil, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	lookup := draftLookup(identity, key)
	if err := q.LockIdempotency(ctx, draftLock(identity, key)); err != nil {
		return reservation{}, nil, nil, err
	}
	if err := q.DeleteExpiredIdempotency(
		ctx, sqlc.DeleteExpiredIdempotencyParams(lookup),
	); err != nil {
		return reservation{}, nil, nil, err
	}
	stored, err := q.GetIdempotency(ctx, lookup)
	switch {
	case err == nil:
		if !bytes.Equal(stored.RequestDigest, digest[:]) {
			return reservation{}, nil, problem.IdempotencyKeyConflictError, nil
		}
		if stored.ResponseStatus.Valid {
			replay, err := decodeReplay(s, stored)
			if err != nil {
				return reservation{}, nil, nil, err
			}
			return reservation{}, &replay, nil, tx.Commit(ctx)
		}
	case errors.Is(err, pgx.ErrNoRows):
		if err := q.CreateIdempotency(ctx, sqlc.CreateIdempotencyParams{
			Operation: draftOperation, BindingID: lookup.BindingID,
			IdempotencyKey: string(key), RequestDigest: digest[:],
			ExpiresAt: dbvalue.Timestamp(s.CurrentTime().Add(24 * time.Hour)),
		}); err != nil {
			return reservation{}, nil, nil, err
		}
	default:
		return reservation{}, nil, nil, err
	}

	if err := q.LockOrgAICredits(ctx, identity.OrgDID); err != nil {
		return reservation{}, nil, nil, err
	}
	standing, state, err := standing(ctx, q, identity.OrgDID)
	if err != nil {
		return reservation{}, nil, nil, err
	}
	switch standing.Availability() {
	case aispec.NotEnabled:
		return reservation{}, nil, orgsproblem.AINotEnabledError, nil
	case aispec.PlanRequired:
		return reservation{}, nil,
			orgsproblem.PlanRequiredError(subscriptionspec.GoldTier), nil
	}
	rows, err := q.ListOrgAIPolicies(ctx, identity.OrgDID)
	if err != nil {
		return reservation{}, nil, nil, err
	}
	now := s.CurrentTime()
	allowed, defaultModel := s.AI.Effective(
		aispec.OpeningDraft, storedPolicies(rows)[aispec.OpeningDraft], now,
	)
	choice := request.ModelOID
	if choice == nil {
		choice = defaultModel
	}
	var model appconfig.AIModel
	found := false
	for _, candidate := range allowed {
		if choice != nil && candidate.OID == *choice {
			model, found = candidate, true
		}
	}
	if !found {
		return reservation{}, nil, orgsproblem.AIModelNotAllowedError, nil
	}
	messages, err := orgai.OpeningDraftMessages(
		request.Instruction, request.CurrentContent,
		orgai.OpeningDraftContext{
			OrgCountry:  state.Country,
			OrgLanguage: state.DefaultLanguage,
		},
	)
	if err != nil {
		return reservation{}, nil, nil, err
	}
	promptBytes := 0
	for _, message := range messages {
		promptBytes += len(message.Content)
	}
	reserved := aicredits.Reservation(
		orgai.Rates(model), promptBytes, len(messages), draftMaxTokens(model),
	)
	if reserved > standing.Balance.Available {
		return reservation{}, nil, orgsproblem.AICreditsInsufficientError(
			reserved, standing.Balance.Available,
		), nil
	}
	usageID, err := dbvalue.NewUUIDv7(now)
	if err != nil {
		return reservation{}, nil, nil, err
	}
	created, err := q.CreateOrgAIUsageReservation(ctx,
		sqlc.CreateOrgAIUsageReservationParams{
			UsageID: usageID, OrgDid: identity.OrgDID, OrgUserID: identity.UserID,
			Operation: string(aispec.OpeningDraft), ModelOid: string(model.OID),
			HostModel:               model.HostModel,
			InputCreditsPerMillion:  model.InputCreditsPerMillionTokens,
			OutputCreditsPerMillion: model.OutputCreditsPerMillionTokens,
			CreditsReserved:         reserved, IdempotencyKey: string(key),
			TenantID: s.TenantID,
		})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return reservation{}, nil, orgsproblem.AIRequestInProgressError, nil
	}
	if err != nil {
		return reservation{}, nil, nil, err
	}
	if created.AuditCount != 1 {
		return reservation{}, nil, nil, fmt.Errorf("unaudited AI reservation")
	}
	return reservation{
		usageID: usageID, reserved: reserved, model: model, messages: messages,
	}, nil, nil, tx.Commit(ctx)
}

func decodeReplay(
	s *orgsruntime.Server, stored sqlc.GetIdempotencyRow,
) (aispec.DraftOpeningResponse, error) {
	if stored.ResponseStatus.Int32 != http.StatusOK {
		return aispec.DraftOpeningResponse{}, fmt.Errorf(
			"unexpected AI draft replay status %d", stored.ResponseStatus.Int32,
		)
	}
	plaintext, err := s.DecryptIdempotency(stored.ResponseCiphertext)
	if err != nil {
		return aispec.DraftOpeningResponse{}, err
	}
	var replay aispec.DraftOpeningResponse
	return replay, json.Unmarshal(plaintext, &replay)
}

// keptMessages is the prompt as kept with the usage record.
func keptMessages(messages []chatmodel.Message) ([]byte, error) {
	return json.Marshal(messages)
}

// textExpiry is when a call's kept prompt and answer are deleted.
func textExpiry(s *orgsruntime.Server) pgtype.Timestamptz {
	return dbvalue.Timestamp(s.CurrentTime().Add(s.AI.Config.TextRetention))
}

// releaseDraft charges nothing and keeps the prompt and any answer. The
// idempotency record stays incomplete, so the caller may retry with the same
// key.
func releaseDraft(
	ctx context.Context, s *orgsruntime.Server, identity middleware.OrgIdentity,
	key common.IdempotencyKey, held reservation,
	reason sqlc.VetchiumOrgAiFailureReason, answer *chatmodel.Response,
) error {
	messages, err := keptMessages(held.messages)
	if err != nil {
		return err
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	params := sqlc.ReleaseOrgAIUsageParams{
		FailureReason: sqlc.NullVetchiumOrgAiFailureReason{
			VetchiumOrgAiFailureReason: reason, Valid: true,
		},
		UsageID: held.usageID, OrgDid: identity.OrgDID,
		RequestMessages: messages,
		TextExpiresAt:   textExpiry(s),
		TenantID:        s.TenantID, IdempotencyKey: dbvalue.Text(string(key)),
	}
	if answer != nil {
		params.InputTokens = pgtype.Int4{Int32: int32(answer.InputTokens), Valid: true}
		params.OutputTokens = pgtype.Int4{Int32: int32(answer.OutputTokens), Valid: true}
		params.ResponseText = dbvalue.Text(answer.Content)
	}
	if _, err := q.LockOrgAIUsage(ctx, sqlc.LockOrgAIUsageParams{
		UsageID: held.usageID, OrgDid: identity.OrgDID,
	}); err != nil {
		return err
	}
	// A reservation the reaper already abandoned needs nothing more.
	if _, err := q.ReleaseOrgAIUsage(ctx, params); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// settleDraft charges the call and stores the response for replays in one
// transaction.
func settleDraft(
	ctx context.Context, s *orgsruntime.Server, identity middleware.OrgIdentity,
	key common.IdempotencyKey, held reservation, answer chatmodel.Response,
	content common.OpeningContent, dropped []string,
) (aispec.DraftOpeningResponse, problem.Body, error) {
	messages, err := keptMessages(held.messages)
	if err != nil {
		return aispec.DraftOpeningResponse{}, nil, err
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return aispec.DraftOpeningResponse{}, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	if err := q.LockIdempotency(ctx, draftLock(identity, key)); err != nil {
		return aispec.DraftOpeningResponse{}, nil, err
	}
	if err := q.LockOrgAICredits(ctx, identity.OrgDID); err != nil {
		return aispec.DraftOpeningResponse{}, nil, err
	}
	locked, err := q.LockOrgAIUsage(ctx, sqlc.LockOrgAIUsageParams{
		UsageID: held.usageID, OrgDid: identity.OrgDID,
	})
	if err != nil {
		return aispec.DraftOpeningResponse{}, nil, err
	}
	if locked.UsageState != sqlc.VetchiumOrgAiUsageStateReserved {
		// The reaper abandoned the reservation while the model was slow; the
		// call is not charged and the answer is not delivered.
		return aispec.DraftOpeningResponse{}, orgsproblem.AIModelFailedError,
			tx.Commit(ctx)
	}
	charge := min(
		aicredits.Cost(orgai.Rates(held.model),
			int64(answer.InputTokens), int64(answer.OutputTokens)),
		held.reserved,
	)
	settled, err := q.SettleOrgAIUsage(ctx, sqlc.SettleOrgAIUsageParams{
		OrgDid: identity.OrgDID, AiPlanOids: orgai.AIPlanOIDs(),
		CreditsCharged: charge,
		InputTokens:    pgtype.Int4{Int32: int32(answer.InputTokens), Valid: true},
		OutputTokens:   pgtype.Int4{Int32: int32(answer.OutputTokens), Valid: true},
		UsageID:        held.usageID, RequestMessages: messages,
		ResponseText:  dbvalue.Text(answer.Content),
		TextExpiresAt: textExpiry(s),
		TenantID:      s.TenantID, IdempotencyKey: dbvalue.Text(string(key)),
	})
	if err != nil {
		return aispec.DraftOpeningResponse{}, nil, err
	}
	if settled.AuditCount != 1 || settled.KeptCount != 1 {
		return aispec.DraftOpeningResponse{}, nil,
			fmt.Errorf("incomplete AI usage settlement")
	}
	after, err := balance(ctx, q, identity.OrgDID)
	if err != nil {
		return aispec.DraftOpeningResponse{}, nil, err
	}
	if dropped == nil {
		dropped = []string{}
	}
	body := aispec.DraftOpeningResponse{
		Content: content, DroppedFields: dropped,
		Usage: aispec.AIUsageCharge{
			UsageID:        aispec.AIUsageID(dbvalue.FormatUUID(held.usageID)),
			ModelOID:       held.model.OID,
			InputTokens:    int32(answer.InputTokens),
			OutputTokens:   int32(answer.OutputTokens),
			CreditsCharged: settled.CreditsCharged,
		},
		BalanceAvailable: after.Available,
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return aispec.DraftOpeningResponse{}, nil, err
	}
	ciphertext, err := s.EncryptIdempotency(encoded)
	if err != nil {
		return aispec.DraftOpeningResponse{}, nil, err
	}
	lookup := draftLookup(identity, key)
	if err := q.CompleteIdempotency(ctx, sqlc.CompleteIdempotencyParams{
		Operation: lookup.Operation, BindingID: lookup.BindingID,
		IdempotencyKey:     lookup.IdempotencyKey,
		ResponseStatus:     pgtype.Int4{Int32: http.StatusOK, Valid: true},
		ResponseCiphertext: ciphertext,
	}); err != nil {
		return aispec.DraftOpeningResponse{}, nil, err
	}
	return body, nil, tx.Commit(ctx)
}
