package workers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/hub/aliaschange"
)

const maxAliasChangeBatchSize = 100

type aliasChangeQueries interface {
	ListRecoverableHubAliasChanges(context.Context, int32) (
		[]sqlc.VetchiumFederationOperation, error,
	)
	HubAliasOperationPreflight(context.Context,
		sqlc.HubAliasOperationPreflightParams) (bool, error)
	RecordFederationOperationRetry(context.Context,
		sqlc.RecordFederationOperationRetryParams) (int64, error)
	ResolveFederationOperation(context.Context,
		sqlc.ResolveFederationOperationParams) (sqlc.ResolveFederationOperationRow, error)
}

// The worker identities recorded as the actor of alias operation changes.
var (
	aliasChangeActor  = dbvalue.Text("hub-alias-change")
	aliasReleaseActor = dbvalue.Text("hub-alias-release")
)

func (w *Worker) completeHubAliasChanges(ctx context.Context) error {
	operations, err := w.aliasChangeQueries.ListRecoverableHubAliasChanges(
		ctx, maxAliasChangeBatchSize,
	)
	if err != nil {
		return fmt.Errorf("list Hub alias changes: %w", err)
	}
	for _, operation := range operations {
		if err := w.completeHubAliasChange(ctx, operation); err != nil {
			return err
		}
	}
	return nil
}

func (w *Worker) completeHubAliasChange(
	ctx context.Context, operation sqlc.VetchiumFederationOperation,
) error {
	payload, did, err := decodeAliasChangeOperation(operation)
	if err != nil {
		return err
	}
	if operation.AttemptCount == 0 {
		mayDispatch, err := w.aliasChangeQueries.HubAliasOperationPreflight(ctx,
			sqlc.HubAliasOperationPreflightParams{
				HubUserDid:             did,
				ExpectedProfileVersion: payload.ExpectedProfileVersion,
			})
		if err != nil {
			return fmt.Errorf("preflight Hub alias change: %w", err)
		}
		if !mayDispatch {
			return w.resolveAliasChange(ctx, operation.OperationID,
				sqlc.VetchiumFederationOperationStateFailed,
				http.StatusConflict)
		}
	}
	// This durable marker precedes the network call. A crash or lost response
	// after it means recovery must replay the same command, even if the local
	// entitlement changed in the meantime.
	updated, err := w.aliasChangeQueries.RecordFederationOperationRetry(ctx,
		sqlc.RecordFederationOperationRetryParams{
			OperationID: operation.OperationID,
			LastError:   "directory command outcome unknown",
			TenantID:    w.tenantID, ActorType: "worker",
			ActorID: aliasChangeActor, Source: "workers",
		})
	if err != nil {
		return fmt.Errorf("mark Hub alias dispatch: %w", err)
	}
	if updated != 1 {
		return fmt.Errorf("hub alias operation no longer pending")
	}
	outcome, err := w.aliasReleaseDirectory.SetHubAlias(ctx,
		directoryspec.SetHubAliasRequest{
			CommandID:  directoryspec.CommandID(dbvalue.FormatUUID(operation.CommandID)),
			HubUserDID: payload.HubUserDID, ProfileAlias: payload.ProfileAlias,
		})
	if err != nil || outcome.Status == http.StatusTooManyRequests ||
		outcome.Status >= http.StatusInternalServerError || outcome.Status < 200 {
		w.log.Warn("Hub alias command will be retried",
			"event", "hub_alias_change_retry",
			"operationID", dbvalue.FormatUUID(operation.OperationID))
		return nil
	}
	if outcome.Status == http.StatusOK {
		if outcome.Principal == nil ||
			outcome.Principal.HubUserDID != payload.HubUserDID ||
			outcome.Principal.HomeTenantID != directoryspec.TenantID(w.tenantID) {
			return fmt.Errorf("inconsistent directory principal for Hub alias operation %s",
				dbvalue.FormatUUID(operation.OperationID))
		}
		return w.finalizeAliasChange(ctx, operation, payload, did)
	}
	if outcome.Status >= 400 && outcome.Status < 500 {
		return w.resolveAliasChange(ctx, operation.OperationID,
			sqlc.VetchiumFederationOperationStateFailed, outcome.Status)
	}
	return fmt.Errorf("unexpected directory status for Hub alias operation: %d",
		outcome.Status)
}

func decodeAliasChangeOperation(
	operation sqlc.VetchiumFederationOperation,
) (aliaschange.Payload, pgtype.UUID, error) {
	var payload aliaschange.Payload
	if operation.Kind != "hub-alias-change" ||
		operation.TargetAuthority != "global-directory" ||
		!bytes.Equal(operation.RequestDigest, aliasChangeDigest(operation.PayloadBytes)) {
		return payload, pgtype.UUID{}, fmt.Errorf("invalid Hub alias operation %s",
			dbvalue.FormatUUID(operation.OperationID))
	}
	if err := json.Unmarshal(operation.PayloadBytes, &payload); err != nil {
		return payload, pgtype.UUID{}, fmt.Errorf("decode Hub alias operation: %w", err)
	}
	did, err := dbvalue.ParseUUID(operation.AggregateID)
	if err != nil || !payload.Valid() ||
		payload.HubUserDID != hubspec.HubUserDID(operation.AggregateID) {
		return payload, pgtype.UUID{}, fmt.Errorf("invalid Hub alias payload for %s",
			dbvalue.FormatUUID(operation.OperationID))
	}
	return payload, did, nil
}

func (w *Worker) finalizeAliasChange(
	ctx context.Context, operation sqlc.VetchiumFederationOperation,
	payload aliaschange.Payload, did pgtype.UUID,
) error {
	tx, err := w.aliasChangeDB.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin Hub alias completion: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	_, err = q.ApplyHubProfileAlias(ctx, sqlc.ApplyHubProfileAliasParams{
		HubUserDid: did, PreviousAlias: aliasValue(payload.PreviousAlias),
		ExpectedProfileVersion: payload.ExpectedProfileVersion,
		ProfileAlias:           aliasValue(payload.ProfileAlias), TenantID: w.tenantID,
		IdempotencyKey: dbvalue.Text(operation.IdempotencyKey),
	})
	state := sqlc.VetchiumFederationOperationStateSucceeded
	status := http.StatusOK
	if errors.Is(err, pgx.ErrNoRows) {
		state = sqlc.VetchiumFederationOperationStateFailed
		status = http.StatusConflict
		if payload.ProfileAlias != nil {
			if err := queueAliasCompensation(
				ctx, q, w.tenantID, operation, payload,
			); err != nil {
				return err
			}
		}
	} else if err != nil {
		return fmt.Errorf("apply Hub alias locally: %w", err)
	}
	_, err = q.ResolveFederationOperation(ctx,
		sqlc.ResolveFederationOperationParams{
			OperationID: operation.OperationID, State: state,
			ResponseStatus:     pgtype.Int4{Int32: int32(status), Valid: true},
			ResponseCiphertext: []byte{},
			TenantID:           w.tenantID, ActorType: "worker",
			ActorID: aliasChangeActor, Source: "workers",
		})
	if err != nil {
		return fmt.Errorf("resolve Hub alias operation: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit Hub alias completion: %w", err)
	}
	if state == sqlc.VetchiumFederationOperationStateFailed &&
		payload.ProfileAlias != nil {
		w.log.Warn("Hub alias claim lost local entitlement; conditional release queued",
			"event", "hub_alias_change_compensated",
			"operationID", dbvalue.FormatUUID(operation.OperationID))
	} else if state == sqlc.VetchiumFederationOperationStateFailed {
		w.log.Warn("Hub alias release could not apply to the current profile",
			"event", "hub_alias_change_failed",
			"operationID", dbvalue.FormatUUID(operation.OperationID))
	}
	return nil
}

func queueAliasCompensation(
	ctx context.Context, q *sqlc.Queries, tenantID string,
	operation sqlc.VetchiumFederationOperation, payload aliaschange.Payload,
) error {
	operationID, err := dbvalue.NewUUID()
	if err != nil {
		return err
	}
	commandID, err := dbvalue.NewUUID()
	if err != nil {
		return err
	}
	commandPayload, err := json.Marshal(struct {
		HubUserDID              hubspec.HubUserDID      `json:"hub_user_did"`
		ProfileAlias            *directoryspec.HubAlias `json:"profile_alias"`
		DowngradeReleaseIfAlias *directoryspec.HubAlias `json:"downgrade_release_if_alias"`
	}{
		HubUserDID:              payload.HubUserDID,
		DowngradeReleaseIfAlias: payload.ProfileAlias,
	})
	if err != nil {
		return err
	}
	digest := aliasChangeDigest(commandPayload)
	_, err = q.CreateFederationOperation(ctx, sqlc.CreateFederationOperationParams{
		OperationID: operationID, CommandID: commandID,
		Kind: "hub-alias-release", TargetAuthority: "global-directory",
		AggregateID:        operation.AggregateID,
		OwnerPrincipalType: operation.OwnerPrincipalType,
		OwnerPrincipalID:   operation.OwnerPrincipalID,
		IdempotencyKey:     dbvalue.FormatUUID(operationID),
		RequestDigest:      digest, PayloadBytes: commandPayload,
		ExpiresAt: dbvalue.Timestamp(time.Now().Add(30 * 24 * time.Hour)),
		TenantID:  tenantID, ActorType: "worker", ActorID: aliasChangeActor,
		Source: "workers",
	})
	if err != nil {
		return fmt.Errorf("queue Hub alias compensation: %w", err)
	}
	return nil
}

func (w *Worker) resolveAliasChange(
	ctx context.Context, operationID pgtype.UUID,
	state sqlc.VetchiumFederationOperationState, status int,
) error {
	_, err := w.aliasChangeQueries.ResolveFederationOperation(ctx,
		sqlc.ResolveFederationOperationParams{
			OperationID: operationID, State: state,
			ResponseStatus:     pgtype.Int4{Int32: int32(status), Valid: true},
			ResponseCiphertext: []byte{},
			TenantID:           w.tenantID, ActorType: "worker",
			ActorID: aliasChangeActor, Source: "workers",
		})
	if err != nil {
		return fmt.Errorf("resolve Hub alias change: %w", err)
	}
	return nil
}

func aliasValue(value *directoryspec.HubAlias) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return dbvalue.Text(string(*value))
}

func aliasChangeDigest(payload []byte) []byte {
	digest := sha256.Sum256(payload)
	return digest[:]
}
