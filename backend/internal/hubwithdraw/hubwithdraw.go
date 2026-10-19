// Package hubwithdraw is the Org tenant's side of the hub-withdraw command:
// it withdraws one Hub user's own application at an Org this tenant homes
// (agent-guides/hiring-pipeline.md, States). The Hub user's home tenant,
// which may be this one, sends it through federation/commands.
package hubwithdraw

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
	"backend/internal/hubapplications"
)

// Register adds the hub-withdraw kind to registry.
func Register(registry *commands.Registry) {
	registry.Register(federationspec.HubWithdrawKind, Handle,
		hubapplications.Applicant)
}

// Handle withdraws the application from any state the applicant may leave,
// or rejects deterministically so a replay returns the same outcome. Only the
// applicant's own application is found; any other is not found.
func Handle(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	payload, fields := decode(command)
	if len(fields) > 0 {
		details := problem.ValidationFailedError
		details.Fields = fields
		return commands.Rejected(details), nil
	}
	applicantDID, err := dbvalue.ParseUUID(string(payload.ApplicantDID))
	if err != nil {
		return commands.Result{}, err
	}
	q := sqlc.New(tx)
	locked, err := q.LockOrgApplicationForApplicant(ctx,
		sqlc.LockOrgApplicationForApplicantParams{
			OrgDid:            command.Authority.DID,
			OpeningNumber:     int32(payload.OpeningNumber),
			ApplicationNumber: int32(payload.ApplicationNumber),
			HubUserDid:        applicantDID,
		})
	if errors.Is(err, pgx.ErrNoRows) {
		return commands.Rejected(hubproblem.ApplicationNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("lock application: %w", err)
	}
	historyID, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		return commands.Result{}, err
	}
	withdrawn, err := q.WithdrawOrgApplication(ctx,
		sqlc.WithdrawOrgApplicationParams{
			ApplicationID: locked.OrgApplicationID, Version: locked.Version,
			HistoryID: historyID, TenantID: command.TenantID,
			OrgDid:         command.Authority.DID,
			OpeningNumber:  int32(payload.OpeningNumber),
			HubUserDid:     dbvalue.FormatUUID(applicantDID),
			CommandID:      dbvalue.FormatUUID(command.CommandID),
			PreviousState:  string(locked.ApplicationState),
			SourceTenantID: command.SourceTenantID,
		})
	if err != nil {
		return commands.Result{}, fmt.Errorf("withdraw application: %w", err)
	}
	if withdrawn.WithdrawnRows == 0 {
		return commands.Rejected(hubproblem.ApplicationStateConflictError), nil
	}
	if withdrawn.WithdrawnRows != 1 || withdrawn.HistoryRows != 1 ||
		withdrawn.AuditRows != 1 {
		return commands.Result{}, fmt.Errorf("incomplete application withdrawal")
	}
	if err := hubapplications.EnqueueChange(
		ctx, tx, locked.OrgApplicationID,
	); err != nil {
		return commands.Result{}, err
	}
	return commands.Succeeded(http.StatusOK, federationspec.HubWithdrawResult{
		OpeningNumber:     payload.OpeningNumber,
		ApplicationNumber: payload.ApplicationNumber,
	}), nil
}

// decode parses the payload strictly: a malformed one will never succeed, so
// it is a deterministic rejection rather than a retried error.
func decode(
	command commands.Command,
) (federationspec.HubWithdrawPayload, []string) {
	var payload federationspec.HubWithdrawPayload
	decoder := json.NewDecoder(bytes.NewReader(command.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil ||
		decoder.Decode(&struct{}{}) != io.EOF {
		return payload, []string{"payload"}
	}
	if command.Authority.Type != directoryspec.PrincipalOrg {
		return payload, []string{"authority_principal_type"}
	}
	payload.Normalize()
	return payload, payload.Validate()
}
