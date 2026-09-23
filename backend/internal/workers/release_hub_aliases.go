package workers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/directoryclient"
)

const maxAliasReleaseBatchSize = 100

type AliasReleaseDirectory interface {
	SetHubAlias(context.Context, directoryspec.SetHubAliasRequest) (
		directoryclient.Outcome, error,
	)
}

type aliasReleaseQueries interface {
	ListRecoverableHubAliasReleases(context.Context, int32) (
		[]sqlc.VetchiumFederationOperation, error,
	)
	RecordFederationOperationRetry(context.Context,
		sqlc.RecordFederationOperationRetryParams) (int64, error)
	ResolveFederationOperation(context.Context,
		sqlc.ResolveFederationOperationParams) (sqlc.VetchiumFederationOperation, error)
}

func (w *Worker) releaseDowngradedHubAliases(ctx context.Context) error {
	operations, err := w.aliasReleaseQueries.ListRecoverableHubAliasReleases(
		ctx, maxAliasReleaseBatchSize,
	)
	if err != nil {
		return fmt.Errorf("list downgraded Hub aliases: %w", err)
	}
	for _, operation := range operations {
		if err := w.releaseDowngradedHubAlias(ctx, operation); err != nil {
			return err
		}
	}
	return nil
}

func (w *Worker) releaseDowngradedHubAlias(
	ctx context.Context, operation sqlc.VetchiumFederationOperation,
) error {
	if operation.TargetAuthority != "global-directory" ||
		operation.Kind != "hub-alias-release" ||
		!bytes.Equal(operation.RequestDigest, digestAliasRelease(operation.PayloadBytes)) {
		return fmt.Errorf("invalid Hub alias release operation %s",
			dbvalue.FormatUUID(operation.OperationID))
	}
	var request directoryspec.SetHubAliasRequest
	if err := json.Unmarshal(operation.PayloadBytes, &request); err != nil {
		return fmt.Errorf("decode Hub alias release operation: %w", err)
	}
	request.CommandID = directoryspec.CommandID(dbvalue.FormatUUID(operation.CommandID))
	if len(request.Validate()) != 0 || request.DowngradeReleaseIfAlias == nil ||
		string(request.HubUserDID) != operation.AggregateID {
		return fmt.Errorf("invalid Hub alias release payload for %s",
			dbvalue.FormatUUID(operation.OperationID))
	}
	outcome, err := w.aliasReleaseDirectory.SetHubAlias(ctx, request)
	if err != nil {
		return w.retryAliasRelease(ctx, operation.OperationID,
			"directory command outcome unknown")
	}
	if outcome.Status >= http.StatusInternalServerError ||
		outcome.Status == http.StatusTooManyRequests {
		return w.retryAliasRelease(ctx, operation.OperationID,
			"directory temporarily unavailable")
	}
	state := sqlc.VetchiumFederationOperationStateFailed
	if outcome.Status == http.StatusOK {
		if outcome.Principal == nil ||
			outcome.Principal.HubUserDID != hubspec.HubUserDID(operation.AggregateID) ||
			outcome.Principal.HomeTenantID != directoryspec.TenantID(w.tenantID) {
			return w.retryAliasRelease(ctx, operation.OperationID,
				"directory returned an inconsistent principal")
		}
		state = sqlc.VetchiumFederationOperationStateSucceeded
	}
	if _, err := w.aliasReleaseQueries.ResolveFederationOperation(ctx,
		sqlc.ResolveFederationOperationParams{
			OperationID: operation.OperationID, State: state,
			ResponseStatus:     pgtype.Int4{Int32: int32(outcome.Status), Valid: true},
			ResponseCiphertext: []byte{},
		}); err != nil {
		return fmt.Errorf("resolve Hub alias release: %w", err)
	}
	if state == sqlc.VetchiumFederationOperationStateFailed {
		w.log.Error("Hub alias release rejected by directory",
			"event", "hub_alias_release_failed",
			"operationID", dbvalue.FormatUUID(operation.OperationID),
			"status", outcome.Status)
	}
	return nil
}

func (w *Worker) retryAliasRelease(
	ctx context.Context, operationID pgtype.UUID, reason string,
) error {
	updated, err := w.aliasReleaseQueries.RecordFederationOperationRetry(ctx,
		sqlc.RecordFederationOperationRetryParams{
			OperationID: operationID, LastError: reason,
		})
	if err != nil {
		return fmt.Errorf("retry Hub alias release: %w", err)
	}
	if updated != 1 {
		return fmt.Errorf("hub alias release operation no longer pending")
	}
	w.log.Warn("Hub alias release retry scheduled",
		"event", "hub_alias_release_retry",
		"operationID", dbvalue.FormatUUID(operationID), "reason", reason)
	return nil
}

func digestAliasRelease(payload []byte) []byte {
	digest := sha256.Sum256(payload)
	return digest[:]
}
