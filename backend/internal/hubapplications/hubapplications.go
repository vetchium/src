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
	case sqlc.VetchiumOrgApplicationStateOffered:
		return hubspec.Offered, nil
	case sqlc.VetchiumOrgApplicationStateOfferAccepted:
		return hubspec.OfferAccepted, nil
	case sqlc.VetchiumOrgApplicationStateJoined:
		return hubspec.Joined, nil
	case sqlc.VetchiumOrgApplicationStateNotProgressing:
		return hubspec.NotSelected, nil
	case sqlc.VetchiumOrgApplicationStateOfferDeclined,
		sqlc.VetchiumOrgApplicationStateDidNotJoin:
		return hubspec.Declined, nil
	case sqlc.VetchiumOrgApplicationStateWithdrawn:
		return hubspec.Withdrawn, nil
	default:
		return "", fmt.Errorf("unknown application state %q", state)
	}
}

// PendingActions lists what awaits the applicant: an upcoming interview they
// have not answered, a background-check consent request, and an offer to
// answer while the application is offered and its offer is still open
// (HP-HUB-003).
func PendingActions(
	state sqlc.VetchiumOrgApplicationState, offerAwaitsAnswer bool,
	interviewAwaitsResponse bool, consentAwaitsResponse bool,
) []hubspec.PendingActionKind {
	actions := []hubspec.PendingActionKind{}
	if interviewAwaitsResponse {
		actions = append(actions, hubspec.InterviewResponse)
	}
	if consentAwaitsResponse {
		actions = append(actions, hubspec.BackgroundCheckConsent)
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
// It asks for no email: use it for a change the applicant caused.
func EnqueueChanges(
	ctx context.Context, q sqlc.Querier, applicationIDs []pgtype.UUID,
) error {
	return EnqueueNotifiedChanges(ctx, q, applicationIDs, "")
}

// NoticeFor maps what an Org did to the email the applicant gets
// (HP-GEN-006). Every action but the ones with their own email may change
// the Hub status, which the applicant's tenant checks before it writes.
func NoticeFor(
	action sqlc.VetchiumOrgApplicationHistoryAction,
) federationspec.ApplicationNotice {
	switch action {
	case sqlc.VetchiumOrgApplicationHistoryActionInterviewScheduled:
		return federationspec.NoticeInterviewScheduled
	case sqlc.VetchiumOrgApplicationHistoryActionInterviewChanged:
		return federationspec.NoticeInterviewChanged
	case sqlc.VetchiumOrgApplicationHistoryActionInterviewCancelled:
		return federationspec.NoticeInterviewCancelled
	case sqlc.VetchiumOrgApplicationHistoryActionBackgroundCheckConsentRequested:
		return federationspec.NoticeConsentRequested
	case sqlc.VetchiumOrgApplicationHistoryActionOfferExtended:
		return federationspec.NoticeOfferExtended
	case sqlc.VetchiumOrgApplicationHistoryActionOfferWithdrawn:
		return federationspec.NoticeOfferWithdrawn
	default:
		return federationspec.NoticeStatusChanged
	}
}

// EnqueueNotifiedChanges is EnqueueChanges asking the applicant's tenant to
// email notice, if it is not empty. It also records when the next unanswered
// interview starts, so the refresh job can re-report the application once
// that time passes (HP-HUB-007).
func EnqueueNotifiedChanges(
	ctx context.Context, q sqlc.Querier, applicationIDs []pgtype.UUID,
	notice federationspec.ApplicationNotice,
) error {
	rows, err := q.GetHubApplicationChanges(ctx, applicationIDs)
	if err != nil {
		return fmt.Errorf("read application changes: %w", err)
	}
	if len(rows) != len(applicationIDs) {
		return fmt.Errorf("read %d of %d changed applications",
			len(rows), len(applicationIDs))
	}
	outgoing := make([]events.Outgoing, 0, len(rows))
	for _, row := range rows {
		status, err := Status(row.ApplicationState, row.StageKind)
		if err != nil {
			return err
		}
		outgoing = append(outgoing, events.Outgoing{
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
					row.InterviewAwaitsResponse, row.ConsentAwaitsResponse,
				),
				AppliedAt:      row.CreatedAt.Time.UTC(),
				LastActivityAt: row.UpdatedAt.Time.UTC(),
				Notice:         notice,
			},
		})
	}
	if err := events.EnqueueAll(ctx, q, outgoing); err != nil {
		return err
	}
	if err := q.SetHubApplicationRefreshTimes(ctx, applicationIDs); err != nil {
		return fmt.Errorf("set application refresh times: %w", err)
	}
	return nil
}

// EnqueueRemoval tells each applicant's tenant to delete the projection of
// an application retention just removed (HP-RET-001). Call it in the
// transaction that removed them, with the versions they now have.
func EnqueueRemoval(
	ctx context.Context, q sqlc.Querier, removed Removal,
) error {
	_, err := events.Enqueue(ctx, q, events.Outgoing{
		Kind: federationspec.HubApplicationRemovedKind,
		Destination: events.Principal{
			Type: directoryspec.PrincipalHubUser, DID: removed.HubUserDID,
		},
		AggregateType: federationspec.OrgApplicationAggregate,
		AggregateID: AggregateID(
			removed.OrgDID, removed.OpeningNumber, removed.ApplicationNumber,
		),
		AggregateVersion: int64(removed.Version),
		Payload: federationspec.HubApplicationRemovedPayload{
			OrgDID:        orgs.OrgDID(dbvalue.FormatUUID(removed.OrgDID)),
			OpeningNumber: openings.OpeningNumber(removed.OpeningNumber),
			ApplicationNumber: orgapplications.ApplicationNumber(
				removed.ApplicationNumber),
		},
	})
	return err
}

// Removal identifies an application retention removed.
type Removal struct {
	HubUserDID        pgtype.UUID
	OrgDID            pgtype.UUID
	OpeningNumber     int32
	ApplicationNumber int32
	Version           int32
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
				row.InterviewAwaitsResponse, row.ConsentAwaitsResponse,
			),
		},
		Interviews: []hubspec.MyApplicationInterview{},
	}
	if err := json.Unmarshal(row.Answers, &detail.Answers); err != nil {
		return hubspec.MyApplicationDetail{}, fmt.Errorf("decode answers: %w", err)
	}
	if err := json.Unmarshal(row.Interviews, &detail.Interviews); err != nil {
		return hubspec.MyApplicationDetail{}, fmt.Errorf("decode interviews: %w", err)
	}
	for index := range detail.Interviews {
		detail.Interviews[index].StartsAt = detail.Interviews[index].StartsAt.UTC()
	}
	if len(row.BackgroundCheck) > 0 {
		if err := json.Unmarshal(row.BackgroundCheck, &detail.BackgroundCheckConsent); err != nil {
			return hubspec.MyApplicationDetail{}, fmt.Errorf("decode background check: %w", err)
		}
		if consent := detail.BackgroundCheckConsent; consent != nil {
			consent.RequestedAt = consent.RequestedAt.UTC()
		}
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
	registry.Register(federationspec.HubApplicationRemovedKind, ProjectRemoval,
		OrgOrigin)
	// Removal carries a version after every change, so a change delayed past
	// it is superseded instead of recreating the deleted row.
	registry.ShareWatermark(federationspec.HubApplicationRemovedKind,
		federationspec.HubApplicationChangedKind)
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
	q := sqlc.New(tx)
	previous, err := q.GetHubApplicationProjectionStatus(ctx,
		sqlc.GetHubApplicationProjectionStatusParams{
			HubUserDid: event.Destination.DID, OrgDid: orgDID,
			OpeningNumber:     int32(payload.OpeningNumber),
			ApplicationNumber: int32(payload.ApplicationNumber),
		})
	known := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("read application projection: %w", err)
	}
	if err := q.UpsertHubApplicationProjection(ctx,
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
		}); err != nil {
		return err
	}
	if !notifies(payload, known, previous) {
		return nil
	}
	return q.InsertHubApplicationNotice(ctx,
		sqlc.InsertHubApplicationNoticeParams{
			HubUserDid: event.Destination.DID, Notice: string(payload.Notice),
			OrgDisplayName: string(payload.OrgDisplayName),
			OpeningTitle:   payload.OpeningTitle,
		})
}

// notifies decides whether the event emails the applicant. A status_changed
// notice emails only a real change of an application the applicant already
// has, and never the applicant's own withdrawal.
func notifies(
	payload federationspec.HubApplicationChangedPayload, known bool,
	previous string,
) bool {
	switch payload.Notice {
	case "":
		return false
	case federationspec.NoticeStatusChanged:
		return known && previous != string(payload.Status) &&
			payload.Status != hubspec.Withdrawn
	default:
		return true
	}
}

// ProjectRemoval deletes the applicant's projection row. A removal for a
// row that is already gone is applied without effect.
func ProjectRemoval(ctx context.Context, tx pgx.Tx, event events.Event) error {
	if event.Destination.Type != directoryspec.PrincipalHubUser ||
		event.AggregateType != federationspec.OrgApplicationAggregate {
		return fmt.Errorf("hub-application-removed for %s %s",
			event.Destination.Type, event.AggregateType)
	}
	var payload federationspec.HubApplicationRemovedPayload
	decoder := json.NewDecoder(bytes.NewReader(event.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil ||
		decoder.Decode(&struct{}{}) != io.EOF {
		return fmt.Errorf("decode hub-application-removed payload: %v", err)
	}
	if fields := payload.Validate(); len(fields) > 0 {
		return fmt.Errorf("invalid hub-application-removed payload: %v", fields)
	}
	orgDID, err := dbvalue.ParseUUID(string(payload.OrgDID))
	if err != nil {
		return err
	}
	if event.AggregateID != AggregateID(orgDID,
		int32(payload.OpeningNumber), int32(payload.ApplicationNumber)) {
		return fmt.Errorf("hub-application-removed aggregate %q does not match its payload",
			event.AggregateID)
	}
	_, err = sqlc.New(tx).DeleteHubApplicationProjection(ctx,
		sqlc.DeleteHubApplicationProjectionParams{
			HubUserDid: event.Destination.DID, OrgDid: orgDID,
			OpeningNumber:     int32(payload.OpeningNumber),
			ApplicationNumber: int32(payload.ApplicationNumber),
		})
	return err
}
