// Package huboffer is the Org tenant's side of the hub-accept-offer and
// hub-decline-offer commands: the applicant answers the offer they read on
// their own application at an Org this tenant homes
// (agent-guides/hiring-pipeline.md, States). The Hub user's home tenant,
// which may be this one, sends them through federation/commands.
package huboffer

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

// Register adds both answer kinds to registry.
func Register(registry *commands.Registry) {
	registry.Register(federationspec.HubAcceptOfferKind, Accept,
		hubapplications.Applicant)
	registry.Register(federationspec.HubDeclineOfferKind, Decline,
		hubapplications.Applicant)
}

// Accept moves the application to offer_accepted.
func Accept(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	return answer(ctx, tx, command, true)
}

// Decline moves the application to offer_declined.
func Decline(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	return answer(ctx, tx, command, false)
}

// answer applies the applicant's answer, or rejects deterministically so a
// replay returns the same outcome. Only the applicant's own application is
// found; an answer to any offer but the open one they read is a state
// conflict.
func answer(
	ctx context.Context, tx pgx.Tx, command commands.Command, accept bool,
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
	answered, err := q.AnswerOrgApplicationOffer(ctx,
		sqlc.AnswerOrgApplicationOfferParams{
			Accept: accept, ApplicationID: locked.OrgApplicationID,
			Version: locked.Version, OfferNumber: int32(payload.OfferNumber),
			HistoryID: historyID, TenantID: command.TenantID,
			OrgDid:         command.Authority.DID,
			OpeningNumber:  int32(payload.OpeningNumber),
			HubUserDid:     dbvalue.FormatUUID(applicantDID),
			CommandID:      dbvalue.FormatUUID(command.CommandID),
			SourceTenantID: command.SourceTenantID,
		})
	if err != nil {
		return commands.Result{}, fmt.Errorf("answer offer: %w", err)
	}
	if answered.ChangedRows == 0 {
		return commands.Rejected(hubproblem.ApplicationStateConflictError), nil
	}
	if answered.ChangedRows != 1 || answered.AnsweredRows != 1 ||
		answered.HistoryRows != 1 || answered.AuditRows != 1 {
		return commands.Result{}, fmt.Errorf("incomplete offer answer")
	}
	if err := hubapplications.EnqueueChange(
		ctx, q, locked.OrgApplicationID,
	); err != nil {
		return commands.Result{}, err
	}
	return commands.Succeeded(http.StatusOK,
		federationspec.HubOfferResponseResult{
			OpeningNumber:     payload.OpeningNumber,
			ApplicationNumber: payload.ApplicationNumber,
			OfferNumber:       payload.OfferNumber,
		}), nil
}

// decode parses the payload strictly: a malformed one will never succeed, so
// it is a deterministic rejection rather than a retried error.
func decode(
	command commands.Command,
) (federationspec.HubOfferResponsePayload, []string) {
	var payload federationspec.HubOfferResponsePayload
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
