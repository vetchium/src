package workers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"testing"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/directoryclient"
	"backend/internal/hub/aliaschange"
)

type aliasChangeQueriesStub struct {
	operations  []sqlc.VetchiumFederationOperation
	mayDispatch bool
	marked      int
	state       sqlc.VetchiumFederationOperationState
	status      int32
}

func (s *aliasChangeQueriesStub) ListRecoverableHubAliasChanges(
	_ context.Context, batchSize int32,
) ([]sqlc.VetchiumFederationOperation, error) {
	if batchSize != maxAliasChangeBatchSize {
		return nil, errors.New("incorrect batch size")
	}
	return s.operations, nil
}

func (s *aliasChangeQueriesStub) HubAliasOperationPreflight(
	_ context.Context, arg sqlc.HubAliasOperationPreflightParams,
) (bool, error) {
	if arg.ExpectedProfileVersion != 3 {
		return false, errors.New("incorrect expected version")
	}
	return s.mayDispatch, nil
}

func (s *aliasChangeQueriesStub) RecordFederationOperationRetry(
	_ context.Context, _ sqlc.RecordFederationOperationRetryParams,
) (int64, error) {
	s.marked++
	return 1, nil
}

func (s *aliasChangeQueriesStub) ResolveFederationOperation(
	_ context.Context, arg sqlc.ResolveFederationOperationParams,
) (sqlc.VetchiumFederationOperation, error) {
	s.state, s.status = arg.State, arg.ResponseStatus.Int32
	return sqlc.VetchiumFederationOperation{}, nil
}

type aliasChangeDirectoryStub struct {
	outcome directoryclient.Outcome
	err     error
	called  int
}

func (s *aliasChangeDirectoryStub) SetHubAlias(
	_ context.Context, request directoryspec.SetHubAliasRequest,
) (directoryclient.Outcome, error) {
	s.called++
	if request.CommandID != "00000000-0000-4000-8000-000000000002" ||
		request.HubUserDID != "00000000-0000-7000-8000-000000000003" ||
		request.ProfileAlias == nil || *request.ProfileAlias != "new-alias" ||
		request.DowngradeReleaseIfAlias != nil {
		return directoryclient.Outcome{}, errors.New("incorrect alias command")
	}
	return s.outcome, s.err
}

func aliasChangeTestOperation(t *testing.T) sqlc.VetchiumFederationOperation {
	t.Helper()
	operationID, _ := dbvalue.ParseUUID("00000000-0000-4000-8000-000000000001")
	commandID, _ := dbvalue.ParseUUID("00000000-0000-4000-8000-000000000002")
	alias := directoryspec.HubAlias("new-alias")
	payload, err := json.Marshal(aliaschange.Payload{
		HubUserDID:   "00000000-0000-7000-8000-000000000003",
		ProfileAlias: &alias, ExpectedProfileVersion: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	return sqlc.VetchiumFederationOperation{
		OperationID: operationID, CommandID: commandID,
		Kind: "hub-alias-change", TargetAuthority: "global-directory",
		AggregateID:  "00000000-0000-7000-8000-000000000003",
		PayloadBytes: payload, RequestDigest: aliasChangeDigest(payload),
	}
}

func TestAliasChangeRecoveryPreflightAndRemoteOutcomes(t *testing.T) {
	for _, test := range []struct {
		name       string
		preflight  bool
		attempts   int32
		outcome    directoryclient.Outcome
		err        error
		wantCalled int
		wantState  sqlc.VetchiumFederationOperationState
		wantStatus int32
	}{
		{"stale before first dispatch", false, 0, directoryclient.Outcome{}, nil,
			0, sqlc.VetchiumFederationOperationStateFailed, http.StatusConflict},
		{"unknown outcome remains pending", true, 0, directoryclient.Outcome{},
			errors.New("lost response"), 1, "", 0},
		{"directory conflict fails", true, 0,
			directoryclient.Outcome{Status: http.StatusConflict}, nil,
			1, sqlc.VetchiumFederationOperationStateFailed, http.StatusConflict},
		{"uncertain prior send bypasses stale preflight", false, 1,
			directoryclient.Outcome{Status: http.StatusConflict}, nil,
			1, sqlc.VetchiumFederationOperationStateFailed, http.StatusConflict},
		{"inconsistent principal is not accepted", true, 0,
			directoryclient.Outcome{Status: http.StatusOK,
				Principal: &directoryspec.PrincipalCommandResponse{
					HubUserDID:   hubspec.HubUserDID("00000000-0000-7000-8000-000000000003"),
					HomeTenantID: "usa1",
				}}, nil, 1, "", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			operation := aliasChangeTestOperation(t)
			operation.AttemptCount = test.attempts
			queries := &aliasChangeQueriesStub{
				operations:  []sqlc.VetchiumFederationOperation{operation},
				mayDispatch: test.preflight,
			}
			directory := &aliasChangeDirectoryStub{
				outcome: test.outcome, err: test.err,
			}
			worker := &Worker{
				aliasChangeQueries:    queries,
				aliasReleaseDirectory: directory,
				tenantID:              "sgp",
				log:                   slog.New(slog.NewTextHandler(io.Discard, nil)),
			}
			err := worker.completeHubAliasChanges(context.Background())
			if test.name == "inconsistent principal is not accepted" {
				if err == nil {
					t.Fatal("inconsistent principal was accepted")
				}
			} else if err != nil {
				t.Fatal(err)
			}
			wantMarked := test.wantCalled
			if directory.called != test.wantCalled || queries.marked != wantMarked ||
				queries.state != test.wantState || queries.status != test.wantStatus {
				t.Fatalf("called=%d marked=%d state=%s status=%d",
					directory.called, queries.marked, queries.state, queries.status)
			}
		})
	}
}

func TestAliasChangeRejectsTamperedOperation(t *testing.T) {
	operation := aliasChangeTestOperation(t)
	operation.RequestDigest = make([]byte, 32)
	worker := &Worker{
		aliasChangeQueries: &aliasChangeQueriesStub{
			operations: []sqlc.VetchiumFederationOperation{operation},
		},
		aliasReleaseDirectory: &aliasChangeDirectoryStub{},
		log:                   slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if err := worker.completeHubAliasChanges(context.Background()); err == nil {
		t.Fatal("tampered operation was dispatched")
	}
}

var _ aliasChangeQueries = (*aliasChangeQueriesStub)(nil)
var _ AliasReleaseDirectory = (*aliasChangeDirectoryStub)(nil)
