// Package hubconsent is the Org tenant's side of the
// hub-give-background-check-consent and hub-decline-background-check-consent
// commands: the applicant answers a consent request on their own application
// at an Org this tenant homes (agent-guides/hiring-pipeline.md, HP-WRK-006 and
// HP-HUB-003). The Hub user's home tenant, which may be this one, sends them
// through federation/commands. Declining completes nothing.
package hubconsent

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

const (
	responseGiven    = "given"
	responseDeclined = "declined"
)

// Register adds both answer kinds to registry.
func Register(registry *commands.Registry) {
	registry.Register(federationspec.HubGiveConsentKind, Give,
		hubapplications.Applicant)
	registry.Register(federationspec.HubDeclineConsentKind, Decline,
		hubapplications.Applicant)
}

// Give records the applicant's consent.
func Give(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	return answer(ctx, tx, command, responseGiven)
}

// Decline records that the applicant refused; nothing else changes.
func Decline(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	return answer(ctx, tx, command, responseDeclined)
}

// answer applies the applicant's answer, or rejects deterministically so a
// replay returns the same outcome. Only the applicant's own application is
// found; a request already answered or ended, or a candidacy that left the
// pipeline, is a state conflict.
func answer(
	ctx context.Context, tx pgx.Tx, command commands.Command, response string,
) (commands.Result, error) {
	payload, fields := decode(command)
	if len(fields) > 0 {
		details := problem.ValidationFailedError
		details.Fields = fields
		return commands.Rejected(details), nil
	}
	applicant, err := dbvalue.ParseUUID(string(payload.ApplicantDID))
	if err != nil {
		return commands.Result{}, err
	}
	q := sqlc.New(tx)
	locked, err := q.LockOrgApplicationForApplicant(ctx,
		sqlc.LockOrgApplicationForApplicantParams{
			OrgDid:            command.Authority.DID,
			OpeningNumber:     int32(payload.OpeningNumber),
			ApplicationNumber: int32(payload.ApplicationNumber),
			HubUserDid:        applicant,
		})
	if errors.Is(err, pgx.ErrNoRows) {
		return commands.Rejected(hubproblem.ApplicationNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("lock application: %w", err)
	}
	known, err := q.OrgBackgroundCheckExists(ctx,
		sqlc.OrgBackgroundCheckExistsParams{
			ApplicationID: locked.OrgApplicationID,
			CheckNumber:   int32(payload.CheckNumber),
		})
	if err != nil {
		return commands.Result{}, fmt.Errorf("find consent request: %w", err)
	}
	if !known {
		return commands.Rejected(hubproblem.ApplicationNotFoundError), nil
	}
	historyID, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		return commands.Result{}, err
	}
	responded, err := q.RespondOrgBackgroundCheckConsent(ctx,
		sqlc.RespondOrgBackgroundCheckConsentParams{
			ApplicationID: locked.OrgApplicationID, Version: locked.Version,
			CheckNumber: int32(payload.CheckNumber), Response: response,
			HistoryID: historyID, TenantID: command.TenantID,
			OrgDid:         command.Authority.DID,
			OpeningNumber:  int32(payload.OpeningNumber),
			HubUserDid:     dbvalue.FormatUUID(applicant),
			CommandID:      dbvalue.FormatUUID(command.CommandID),
			SourceTenantID: command.SourceTenantID,
		})
	if err != nil {
		return commands.Result{}, fmt.Errorf("answer consent request: %w", err)
	}
	if responded.ChangedRows == 0 {
		return commands.Rejected(hubproblem.ApplicationStateConflictError), nil
	}
	if responded.ChangedRows != 1 || responded.RespondedRows != 1 ||
		responded.HistoryRows != 1 || responded.AuditRows != 1 {
		return commands.Result{}, fmt.Errorf("incomplete consent answer")
	}
	if err := hubapplications.EnqueueChange(
		ctx, q, locked.OrgApplicationID,
	); err != nil {
		return commands.Result{}, err
	}
	return commands.Succeeded(http.StatusOK,
		federationspec.HubBackgroundCheckConsentResult{
			OpeningNumber:     payload.OpeningNumber,
			ApplicationNumber: payload.ApplicationNumber,
			CheckNumber:       payload.CheckNumber,
		}), nil
}

// decode parses the payload strictly: a malformed one will never succeed, so
// it is a deterministic rejection rather than a retried error.
func decode(
	command commands.Command,
) (federationspec.HubBackgroundCheckConsentPayload, []string) {
	var payload federationspec.HubBackgroundCheckConsentPayload
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
