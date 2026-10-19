// Package hubapplications is the Hub-facing side of applications
// (agent-guides/hiring-pipeline.md, HP-GEN-004 and HP-HUB). At the Org's
// tenant it derives the Hub status, reads an application live for its
// applicant, and enqueues the projection event on every change; at the
// applicant's home tenant it applies that event to the projection.
package hubapplications

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	hubspec "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/orgs"
	orgapplications "github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/openings"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
	"backend/internal/federation/events"
)

// ErrNotFound reports an application that is unknown or not the applicant's.
var ErrNotFound = errors.New("application not found for the applicant")

// Applicant is the initiator of every command a Hub user sends about their
// own application: the payload's applicant, who alone may act on it.
func Applicant(command commands.Command) (commands.Principal, bool) {
	var payload struct {
		ApplicantDID string `json:"applicant_did"`
	}
	if json.Unmarshal(command.Payload, &payload) != nil {
		return commands.Principal{}, false
	}
	did, err := dbvalue.ParseUUID(payload.ApplicantDID)
	if err != nil {
		return commands.Principal{}, false
	}
	return commands.Principal{Type: directoryspec.PrincipalHubUser, DID: did}, true
}

// Status derives what the applicant sees from the application's state and
// the kind of its current stage (HP-HUB-001); it is never stored at the
// Org's tenant.
func Status(
	state sqlc.VetchiumOrgApplicationState,
	stage sqlc.NullVetchiumPipelineStageKind,
) (hubspec.ApplicationStatus, error) {
	switch state {
	case sqlc.VetchiumOrgApplicationStateSubmitted:
		return hubspec.Applied, nil
	case sqlc.VetchiumOrgApplicationStateInPipeline:
		if stage.Valid &&
			stage.VetchiumPipelineStageKind == sqlc.VetchiumPipelineStageKindInterview {
			return hubspec.Interviewing, nil
		}
		return hubspec.InReview, nil
	case sqlc.VetchiumOrgApplicationStateOffered,
		sqlc.VetchiumOrgApplicationStateOfferAccepted:
		return hubspec.Offer, nil
	case sqlc.VetchiumOrgApplicationStateJoined:
		return hubspec.Hired, nil
	case sqlc.VetchiumOrgApplicationStateNotProgressing,
		sqlc.VetchiumOrgApplicationStateOfferDeclined,
		sqlc.VetchiumOrgApplicationStateDidNotJoin:
		return hubspec.NotProgressing, nil
	case sqlc.VetchiumOrgApplicationStateWithdrawn:
		return hubspec.Withdrawn, nil
	default:
		return "", fmt.Errorf("unknown application state %q", state)
	}
}

// PendingActions lists what awaits the applicant: an upcoming interview they
// have not answered, and an offer to answer while the application is offered
// and its offer is still open (HP-HUB-003).
func PendingActions(
	state sqlc.VetchiumOrgApplicationState, offerAwaitsAnswer bool,
	interviewAwaitsResponse bool,
) []hubspec.PendingActionKind {
	actions := []hubspec.PendingActionKind{}
	if interviewAwaitsResponse {
		actions = append(actions, hubspec.InterviewResponse)
	}
	if state == sqlc.VetchiumOrgApplicationStateOffered && offerAwaitsAnswer {
		actions = append(actions, hubspec.OfferResponse)
	}
	return actions
}

// LetterSigner signs a short-lived read URL for an offer letter in the Org's
// tenant, where the letter is stored.
type LetterSigner interface {
	SignOfferLetterGet(context.Context, pgtype.UUID) (string, error)
}

// AggregateID names an application in hub-application-changed events.
func AggregateID(
	orgDID pgtype.UUID, opening int32, application int32,
) string {
	return fmt.Sprintf("%s:%d:%d", dbvalue.FormatUUID(orgDID), opening,
		application)
}

// EnqueueChange reports the application's current state to its applicant's
// home tenant. Call it in every transaction that changes an application,
// after the change, beside that change's audit event.
func EnqueueChange(
	ctx context.Context, q sqlc.Querier, applicationID pgtype.UUID,
) error {
	return EnqueueChanges(ctx, q, []pgtype.UUID{applicationID})
}

// EnqueueChanges is EnqueueChange for several applications, read together.
func EnqueueChanges(
	ctx context.Context, q sqlc.Querier, applicationIDs []pgtype.UUID,
) error {
	rows, err := q.GetHubApplicationChanges(ctx, applicationIDs)
	if err != nil {
		return fmt.Errorf("read application changes: %w", err)
	}
	if len(rows) != len(applicationIDs) {
		return fmt.Errorf("read %d of %d changed applications",
			len(rows), len(applicationIDs))
	}
	for _, row := range rows {
		status, err := Status(row.ApplicationState, row.StageKind)
		if err != nil {
			return err
		}
		if _, err := events.Enqueue(ctx, q, events.Outgoing{
			Kind: federationspec.HubApplicationChangedKind,
			Destination: events.Principal{
				Type: directoryspec.PrincipalHubUser, DID: row.HubUserDid,
			},
			AggregateType: federationspec.OrgApplicationAggregate,
			AggregateID: AggregateID(
				row.OrgDid, row.OpeningNumber, row.ApplicationNumber,
			),
			AggregateVersion: int64(row.Version),
			Payload: federationspec.HubApplicationChangedPayload{
				OrgDID:            orgs.OrgDID(dbvalue.FormatUUID(row.OrgDid)),
				OrgDomain:         orgs.OrgDomain(row.OrgDomain),
				OrgDisplayName:    common.DisplayName(row.OrgDisplayName),
				OpeningNumber:     openings.OpeningNumber(row.OpeningNumber),
				OpeningTitle:      row.OpeningTitle,
				ApplicationNumber: orgapplications.ApplicationNumber(row.ApplicationNumber),
				Status:            status,
				PendingActions: PendingActions(
					row.ApplicationState, row.OfferAwaitsAnswer,
					row.InterviewAwaitsResponse,
				),
				AppliedAt:      row.CreatedAt.Time.UTC(),
				LastActivityAt: row.UpdatedAt.Time.UTC(),
			},
		}); err != nil {
			return err
		}
	}
	return nil
}

// ReadForApplicant reads one application live at the Org's tenant, only if
// it is the applicant's own, signing its offer letter's link there.
func ReadForApplicant(
	ctx context.Context, q sqlc.Querier, letters LetterSigner,
	request hubspec.MeshGetApplicationRequest,
) (hubspec.MyApplicationDetail, error) {
	applicant, err := dbvalue.ParseUUID(string(request.ApplicantDID))
	if err != nil {
		return hubspec.MyApplicationDetail{}, err
	}
	row, err := q.GetOrgApplicationForApplicant(ctx,
		sqlc.GetOrgApplicationForApplicantParams{
			Domain:            string(request.Domain),
			OpeningNumber:     int32(request.OpeningNumber),
			ApplicationNumber: int32(request.ApplicationNumber),
			HubUserDid:        applicant,
		})
	if errors.Is(err, pgx.ErrNoRows) {
		return hubspec.MyApplicationDetail{}, ErrNotFound
	}
	if err != nil {
		return hubspec.MyApplicationDetail{}, fmt.Errorf("read application: %w", err)
	}
	status, err := Status(row.ApplicationState, row.StageKind)
	if err != nil {
		return hubspec.MyApplicationDetail{}, err
	}
	detail := hubspec.MyApplicationDetail{
		MyApplication: hubspec.MyApplication{
			OrgDomain:         orgs.OrgDomain(row.OrgDomain),
			OrgDisplayName:    common.DisplayName(row.OrgDisplayName),
			OpeningNumber:     openings.OpeningNumber(row.OpeningNumber),
			OpeningTitle:      row.OpeningTitle,
			ApplicationNumber: orgapplications.ApplicationNumber(row.ApplicationNumber),
			Status:            status,
			PendingActions: PendingActions(
				row.ApplicationState, row.OfferAwaitsAnswer,
				row.InterviewAwaitsResponse,
			),
		},
		Interviews: []hubspec.MyApplicationInterview{},
	}
	if err := json.Unmarshal(row.Interviews, &detail.Interviews); err != nil {
		return hubspec.MyApplicationDetail{}, fmt.Errorf("decode interviews: %w", err)
	}
	for index := range detail.Interviews {
		detail.Interviews[index].StartsAt = detail.Interviews[index].StartsAt.UTC()
	}
	if !row.HasOffer {
		return detail, nil
	}
	letterURL, err := letters.SignOfferLetterGet(ctx, row.LetterObjectID)
	if err != nil {
		return hubspec.MyApplicationDetail{}, fmt.Errorf("sign offer letter: %w", err)
	}
	offer := hubspec.MyApplicationOffer{
		OfferNumber:    orgapplications.OfferNumber(row.OfferNumber),
		Status:         orgapplications.OfferStatus(row.OfferStatus),
		LetterURL:      letterURL,
		LetterByteSize: row.LetterByteSize,
		RespondBy:      row.RespondBy.Time.UTC(),
		ExtendedAt:     row.ExtendedAt.Time.UTC(),
	}
	if row.ProposedJoiningDate.Valid {
		date := orgapplications.FormatCalendarDate(row.ProposedJoiningDate.Time)
		offer.ProposedJoiningDate = &date
	}
	detail.Offer = &offer
	return detail, nil
}

// Register adds the projection receiver to registry.
func Register(registry *events.Registry) {
	registry.Register(federationspec.HubApplicationChangedKind, Project,
		OrgOrigin)
}

// OrgOrigin is the origin of hub-application-changed: the Org whose
// application changed, which only its home tenant may report on.
func OrgOrigin(event events.Event) (events.Principal, bool) {
	var payload struct {
		OrgDID string `json:"org_did"`
	}
	if json.Unmarshal(event.Payload, &payload) != nil {
		return events.Principal{}, false
	}
	did, err := dbvalue.ParseUUID(payload.OrgDID)
	if err != nil {
		return events.Principal{}, false
	}
	return events.Principal{Type: directoryspec.PrincipalOrg, DID: did}, true
}

// Project writes the applicant's projection row. The receiver calls it only
// for an event newer than the watermark, so it always overwrites. A payload
// that breaks the contract is an error, redelivered until fixed.
func Project(ctx context.Context, tx pgx.Tx, event events.Event) error {
	if event.Destination.Type != directoryspec.PrincipalHubUser ||
		event.AggregateType != federationspec.OrgApplicationAggregate {
		return fmt.Errorf("hub-application-changed for %s %s",
			event.Destination.Type, event.AggregateType)
	}
	var payload federationspec.HubApplicationChangedPayload
	decoder := json.NewDecoder(bytes.NewReader(event.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil ||
		decoder.Decode(&struct{}{}) != io.EOF {
		return fmt.Errorf("decode hub-application-changed payload: %v", err)
	}
	if fields := payload.Validate(); len(fields) > 0 {
		return fmt.Errorf("invalid hub-application-changed payload: %v", fields)
	}
	orgDID, err := dbvalue.ParseUUID(string(payload.OrgDID))
	if err != nil {
		return err
	}
	if event.AggregateID != AggregateID(orgDID,
		int32(payload.OpeningNumber), int32(payload.ApplicationNumber)) {
		return fmt.Errorf("hub-application-changed aggregate %q does not match its payload",
			event.AggregateID)
	}
	projectionID, err := dbvalue.NewUUIDv7(payload.AppliedAt)
	if err != nil {
		return err
	}
	actions := make([]string, len(payload.PendingActions))
	for index, action := range payload.PendingActions {
		actions[index] = string(action)
	}
	return sqlc.New(tx).UpsertHubApplicationProjection(ctx,
		sqlc.UpsertHubApplicationProjectionParams{
			ProjectionID: projectionID, HubUserDid: event.Destination.DID,
			OrgDid: orgDID, OrgDomain: string(payload.OrgDomain),
			OrgDisplayName:    string(payload.OrgDisplayName),
			OpeningNumber:     int32(payload.OpeningNumber),
			OpeningTitle:      payload.OpeningTitle,
			ApplicationNumber: int32(payload.ApplicationNumber),
			HubStatus:         string(payload.Status),
			PendingActions:    actions,
			AppliedAt:         dbvalue.Timestamp(payload.AppliedAt),
			LastActivityAt:    dbvalue.Timestamp(payload.LastActivityAt),
		})
}
