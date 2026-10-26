// Package hubinterview is the Org tenant's side of the hub-accept-interview
// and hub-request-interview-reschedule commands: the applicant answers an
// upcoming interview they read on their own application at an Org this
// tenant homes (agent-guides/hiring-pipeline.md, HP-WRK-003). The Hub user's
// home tenant, which may be this one, sends them through
// federation/commands.
package hubinterview

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
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/openings"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
	"backend/internal/hubapplications"
)

const (
	responseAccepted   = "accepted"
	responseReschedule = "reschedule_requested"
)

// Register adds both answer kinds to registry.
func Register(registry *commands.Registry) {
	registry.Register(federationspec.HubAcceptInterviewKind, Accept,
		hubapplications.Applicant)
	registry.Register(federationspec.HubRescheduleInterviewKind, Reschedule,
		hubapplications.Applicant)
}

// target is what both payloads name.
type target struct {
	openingNumber     int32
	applicationNumber int32
	interviewNumber   int32
	applicantDID      pgtype.UUID
	response          string
	note              pgtype.Text
}

// Accept marks the interview accepted.
func Accept(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	var payload federationspec.HubAcceptInterviewPayload
	if fields := decode(command, &payload); len(fields) > 0 {
		return reject(fields), nil
	}
	applicant, err := dbvalue.ParseUUID(string(payload.ApplicantDID))
	if err != nil {
		return commands.Result{}, err
	}
	return answer(ctx, tx, command, target{
		openingNumber:     int32(payload.OpeningNumber),
		applicationNumber: int32(payload.ApplicationNumber),
		interviewNumber:   int32(payload.InterviewNumber),
		applicantDID:      applicant, response: responseAccepted,
	})
}

// Reschedule records the applicant's request to move the interview.
func Reschedule(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	var payload federationspec.HubRescheduleInterviewPayload
	if fields := decode(command, &payload); len(fields) > 0 {
		return reject(fields), nil
	}
	applicant, err := dbvalue.ParseUUID(string(payload.ApplicantDID))
	if err != nil {
		return commands.Result{}, err
	}
	return answer(ctx, tx, command, target{
		openingNumber:     int32(payload.OpeningNumber),
		applicationNumber: int32(payload.ApplicationNumber),
		interviewNumber:   int32(payload.InterviewNumber),
		applicantDID:      applicant, response: responseReschedule,
		note: dbvalue.Text(string(payload.Note)),
	})
}

// answer applies the applicant's answer, or rejects deterministically so a
// replay returns the same outcome. Only the applicant's own application is
// found; an interview that is cancelled, past, or already answered that way
// is a state conflict.
func answer(
	ctx context.Context, tx pgx.Tx, command commands.Command, t target,
) (commands.Result, error) {
	q := sqlc.New(tx)
	locked, err := q.LockOrgApplicationForApplicant(ctx,
		sqlc.LockOrgApplicationForApplicantParams{
			OrgDid: command.Authority.DID, OpeningNumber: t.openingNumber,
			ApplicationNumber: t.applicationNumber, HubUserDid: t.applicantDID,
		})
	if errors.Is(err, pgx.ErrNoRows) {
		return commands.Rejected(hubproblem.ApplicationNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("lock application: %w", err)
	}
	known, err := q.OrgInterviewExists(ctx, sqlc.OrgInterviewExistsParams{
		ApplicationID: locked.OrgApplicationID, InterviewNumber: t.interviewNumber,
	})
	if err != nil {
		return commands.Result{}, fmt.Errorf("find interview: %w", err)
	}
	if !known {
		return commands.Rejected(hubproblem.ApplicationNotFoundError), nil
	}
	historyID, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		return commands.Result{}, err
	}
	responded, err := q.RespondOrgInterview(ctx, sqlc.RespondOrgInterviewParams{
		ApplicationID: locked.OrgApplicationID, Version: locked.Version,
		InterviewNumber: t.interviewNumber, Response: t.response, Note: t.note,
		HistoryID: historyID, TenantID: command.TenantID,
		OrgDid: command.Authority.DID, OpeningNumber: t.openingNumber,
		HubUserDid:     dbvalue.FormatUUID(t.applicantDID),
		CommandID:      dbvalue.FormatUUID(command.CommandID),
		SourceTenantID: command.SourceTenantID,
	})
	if err != nil {
		return commands.Result{}, fmt.Errorf("answer interview: %w", err)
	}
	if responded.ChangedRows == 0 {
		return commands.Rejected(hubproblem.ApplicationStateConflictError), nil
	}
	if responded.ChangedRows != 1 || responded.RespondedRows != 1 ||
		responded.HistoryRows != 1 || responded.AuditRows != 1 {
		return commands.Result{}, fmt.Errorf("incomplete interview answer")
	}
	if err := hubapplications.EnqueueChange(
		ctx, q, locked.OrgApplicationID,
	); err != nil {
		return commands.Result{}, err
	}
	return commands.Succeeded(http.StatusOK,
		federationspec.HubInterviewResponseResult{
			OpeningNumber:     openingNumber(t.openingNumber),
			ApplicationNumber: applicationNumber(t.applicationNumber),
			InterviewNumber:   interviewNumber(t.interviewNumber),
		}), nil
}

func reject(fields []string) commands.Result {
	details := problem.ValidationFailedError
	details.Fields = fields
	return commands.Rejected(details)
}

// decode parses the payload strictly: a malformed one will never succeed, so
// it is a deterministic rejection rather than a retried error.
func decode[P interface {
	Normalize()
	Validate() []string
}](command commands.Command, payload P) []string {
	decoder := json.NewDecoder(bytes.NewReader(command.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(payload); err != nil ||
		decoder.Decode(&struct{}{}) != io.EOF {
		return []string{"payload"}
	}
	if command.Authority.Type != directoryspec.PrincipalOrg {
		return []string{"authority_principal_type"}
	}
	payload.Normalize()
	return payload.Validate()
}

func openingNumber(value int32) openings.OpeningNumber {
	return openings.OpeningNumber(value)
}

func applicationNumber(value int32) applications.ApplicationNumber {
	return applications.ApplicationNumber(value)
}

func interviewNumber(value int32) applications.InterviewNumber {
	return applications.InterviewNumber(value)
}
