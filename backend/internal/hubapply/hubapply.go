// Package hubapply is the Org tenant's side of the hub-apply command: it
// admits one Hub user's application to a published Opening of an Org this
// tenant homes (agent-guides/hiring-pipeline.md, Applying). The Hub user's
// home tenant, which may be this one, sends it through federation/commands.
package hubapply

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
	"backend/internal/hubapplications"
)

// Register adds the hub-apply kind to registry.
func Register(registry *commands.Registry) {
	registry.Register(federationspec.HubApplyKind, Handle,
		hubapplications.Applicant)
}

// Handle admits the application, or rejects it deterministically so a replay
// returns the same outcome. The Opening row lock taken first serializes
// numbering and the one-application-ever check for the Opening.
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
	target, err := q.LockOrgOpeningForApplication(ctx,
		sqlc.LockOrgOpeningForApplicationParams{
			OrgDid: command.Authority.DID, OpeningNumber: int32(payload.OpeningNumber),
		})
	if errors.Is(err, pgx.ErrNoRows) {
		return commands.Rejected(hubproblem.OpeningNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("lock Opening for application: %w", err)
	}
	// A suspended Org stops new applications (HP-APP-006).
	if target.OrgState != sqlc.VetchiumOrgStateActive ||
		target.OpeningState != sqlc.VetchiumOrgOpeningStatePublished {
		return commands.Rejected(hubproblem.OpeningNotAcceptingError), nil
	}
	snapshot, err := json.Marshal(payload.Snapshot)
	if err != nil {
		return commands.Result{}, fmt.Errorf("encode applicant snapshot: %w", err)
	}
	now := time.Now()
	ids := make([]pgtype.UUID, 3)
	for index := range ids {
		if ids[index], err = dbvalue.NewUUIDv7(now); err != nil {
			return commands.Result{}, err
		}
	}
	applicantID, err := q.EnsureOrgApplicant(ctx, sqlc.EnsureOrgApplicantParams{
		ApplicantID: ids[0], OrgDid: command.Authority.DID,
		HubUserDid: applicantDID,
	})
	if err != nil {
		return commands.Result{}, fmt.Errorf("ensure applicant: %w", err)
	}
	var coverNote *string
	if payload.CoverNote != nil {
		text := string(*payload.CoverNote)
		coverNote = &text
	}
	var creditedEngagementID pgtype.UUID
	var referralRoute pgtype.Text
	if payload.Referral != nil {
		row, err := q.GetAssignedSourcingEngagementForDomain(ctx,
			sqlc.GetAssignedSourcingEngagementForDomainParams{
				OrgOpeningID:   target.OrgOpeningID,
				ProviderDomain: string(payload.Referral.AgencyDomain),
			})
		if errors.Is(err, pgx.ErrNoRows) {
			return commands.Rejected(hubproblem.ReferralAgencyNotEligibleError), nil
		}
		if err != nil {
			return commands.Result{}, fmt.Errorf("check sourcing engagement for referral: %w", err)
		}
		creditedEngagementID = row.EngagementID
		referralRoute = dbvalue.Text(string(payload.Referral.Route))
	}
	created, err := q.CreateOrgApplication(ctx, sqlc.CreateOrgApplicationParams{
		ApplicationID:        ids[1],
		OrgOpeningID:         target.OrgOpeningID,
		ApplicationNumber:    target.NextApplicationNumber,
		ApplicantID:          applicantID,
		Snapshot:             snapshot,
		CoverNote:            dbvalue.NullText(coverNote),
		CreditedEngagementID: creditedEngagementID,
		ReferralRoute:        referralRoute,
		HistoryID:            ids[2],
		TenantID:             command.TenantID,
		OrgDid:               command.Authority.DID,
		OpeningNumber:        int32(payload.OpeningNumber),
		HubUserDid:           dbvalue.FormatUUID(applicantDID),
		CommandID:            dbvalue.FormatUUID(command.CommandID),
		SourceTenantID:       command.SourceTenantID,
	})
	if err != nil {
		return commands.Result{}, fmt.Errorf("create application: %w", err)
	}
	if created.CreatedRows == 0 {
		return commands.Rejected(hubproblem.ApplicationExistsError), nil
	}
	if created.CreatedRows != 1 || created.CounterRows != 1 ||
		created.HistoryRows != 1 || created.AuditRows != 1 {
		return commands.Result{}, fmt.Errorf("incomplete application creation")
	}
	if err := hubapplications.EnqueueChange(ctx, sqlc.New(tx), ids[1]); err != nil {
		return commands.Result{}, err
	}
	return commands.Succeeded(201, federationspec.HubApplyResult{
		OpeningNumber:     payload.OpeningNumber,
		ApplicationNumber: applications.ApplicationNumber(created.ApplicationNumber),
	}), nil
}

// decode parses the payload strictly: a malformed one will never succeed, so
// it is a deterministic rejection rather than a retried error.
func decode(
	command commands.Command,
) (federationspec.HubApplyPayload, []string) {
	var payload federationspec.HubApplyPayload
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
