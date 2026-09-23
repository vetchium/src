package workers

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/directoryclient"
)

type aliasReleaseQueriesStub struct {
	operations []sqlc.VetchiumFederationOperation
	state      sqlc.VetchiumFederationOperationState
	status     int32
	retried    int
}

func (s *aliasReleaseQueriesStub) ListRecoverableHubAliasReleases(
	_ context.Context, batchSize int32,
) ([]sqlc.VetchiumFederationOperation, error) {
	if batchSize != maxAliasReleaseBatchSize {
		return nil, errors.New("incorrect alias release batch size")
	}
	return s.operations, nil
}

func (s *aliasReleaseQueriesStub) RecordFederationOperationRetry(
	_ context.Context, _ sqlc.RecordFederationOperationRetryParams,
) (int64, error) {
	s.retried++
	return 1, nil
}

func (s *aliasReleaseQueriesStub) ResolveFederationOperation(
	_ context.Context, arg sqlc.ResolveFederationOperationParams,
) (sqlc.VetchiumFederationOperation, error) {
	s.state, s.status = arg.State, arg.ResponseStatus.Int32
	if !arg.ResponseStatus.Valid || arg.ResponseCiphertext == nil {
		return sqlc.VetchiumFederationOperation{}, errors.New("missing durable outcome")
	}
	return sqlc.VetchiumFederationOperation{}, nil
}

type aliasReleaseDirectoryStub struct {
	outcome directoryclient.Outcome
	err     error
	called  int
}

func (s *aliasReleaseDirectoryStub) SetHubAlias(
	_ context.Context, request directoryspec.SetHubAliasRequest,
) (directoryclient.Outcome, error) {
	s.called++
	if request.CommandID != directoryspec.CommandID("00000000-0000-4000-8000-000000000002") ||
		request.ProfileAlias != nil || request.DowngradeReleaseIfAlias == nil ||
		*request.DowngradeReleaseIfAlias != "old-alias" {
		return directoryclient.Outcome{}, errors.New("incorrect release command")
	}
	return s.outcome, s.err
}

func TestDowngradeAliasReleaseRecovery(t *testing.T) {
	const did = "00000000-0000-7000-8000-000000000003"
	for _, test := range []struct {
		name       string
		outcome    directoryclient.Outcome
		err        error
		wantState  sqlc.VetchiumFederationOperationState
		wantRetry  int
		wantStatus int32
	}{
		{
			name: "released", outcome: directoryclient.Outcome{
				Status: http.StatusOK,
				Principal: &directoryspec.PrincipalCommandResponse{
					HubUserDID: hubspec.HubUserDID(did), HomeTenantID: "sgp",
				},
			},
			wantState:  sqlc.VetchiumFederationOperationStateSucceeded,
			wantStatus: http.StatusOK,
		},
		{
			name: "rejected", outcome: directoryclient.Outcome{
				Status: http.StatusConflict,
			},
			wantState:  sqlc.VetchiumFederationOperationStateFailed,
			wantStatus: http.StatusConflict,
		},
		{
			name: "lost response", err: errors.New("network"), wantRetry: 1,
		},
		{
			name: "server unavailable", outcome: directoryclient.Outcome{
				Status: http.StatusServiceUnavailable,
			}, wantRetry: 1,
		},
		{
			name: "inconsistent principal", outcome: directoryclient.Outcome{
				Status: http.StatusOK,
				Principal: &directoryspec.PrincipalCommandResponse{
					HubUserDID: hubspec.HubUserDID(did), HomeTenantID: "usa1",
				},
			}, wantRetry: 1,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			operationID, _ := dbvalue.ParseUUID("00000000-0000-4000-8000-000000000001")
			commandID, _ := dbvalue.ParseUUID("00000000-0000-4000-8000-000000000002")
			payload := []byte(`{"hub_user_did":"` + did + `","profile_alias":null,"downgrade_release_if_alias":"old-alias"}`)
			queries := &aliasReleaseQueriesStub{operations: []sqlc.VetchiumFederationOperation{{
				OperationID: operationID, CommandID: commandID,
				Kind: "hub-alias-release", TargetAuthority: "global-directory",
				AggregateID: did, RequestDigest: digestAliasRelease(payload),
				PayloadBytes: payload,
			}}}
			directory := &aliasReleaseDirectoryStub{outcome: test.outcome, err: test.err}
			worker := &Worker{
				aliasReleaseQueries: queries, aliasReleaseDirectory: directory,
				tenantID: "sgp", log: slog.New(slog.NewTextHandler(io.Discard, nil)),
			}
			if err := worker.releaseDowngradedHubAliases(context.Background()); err != nil {
				t.Fatal(err)
			}
			if directory.called != 1 || queries.retried != test.wantRetry ||
				queries.state != test.wantState || queries.status != test.wantStatus {
				t.Fatalf("called=%d retry=%d state=%s status=%d",
					directory.called, queries.retried, queries.state, queries.status)
			}
		})
	}
}

func TestDowngradeAliasReleaseRejectsTamperedPayload(t *testing.T) {
	queries := &aliasReleaseQueriesStub{operations: []sqlc.VetchiumFederationOperation{{
		OperationID: pgtype.UUID{Valid: true},
		Kind:        "hub-alias-release", TargetAuthority: "global-directory",
		RequestDigest: digestAliasRelease([]byte(`{"profile_alias":null}`)),
		PayloadBytes:  []byte(`{"profile_alias":"attacker"}`),
	}}}
	directory := &aliasReleaseDirectoryStub{}
	worker := &Worker{
		aliasReleaseQueries: queries, aliasReleaseDirectory: directory,
		log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if err := worker.releaseDowngradedHubAliases(context.Background()); err == nil ||
		directory.called != 0 {
		t.Fatal("tampered operation was dispatched")
	}
}
