// Package applications serves the Orgs reads of an Opening's applications.
// Visibility (agent-guides/hiring-pipeline.md, HP-AUTH) is decided in each
// query, and an application the caller may not read is indistinguishable from
// an unknown number.
package applications

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/openings"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

const (
	listPaginationPurpose    = "orgs-list-applications-v1"
	historyPaginationPurpose = "orgs-application-history-v1"
)

// defaultCandidateStates is what the Candidates view lists without a state
// filter: the live candidacies.
var defaultCandidateStates = []string{
	string(applications.InPipeline), string(applications.Offered),
	string(applications.OfferAccepted),
}

type listCursor struct {
	AfterApplicationNumber int32                  `json:"after_application_number"`
	OpeningNumber          openings.OpeningNumber `json:"opening_number"`
	FiltersHash            string                 `json:"filters_hash"`
}

func filtersHash(request applications.ListApplicationsRequest) (string, error) {
	request.PaginationKey = nil
	request.Limit = nil
	data, err := json.Marshal(request)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

func stagePointer(
	id pgtype.UUID, name pgtype.Text, kind sqlc.NullVetchiumPipelineStageKind,
) *hiring.PipelineStage {
	if !id.Valid {
		return nil
	}
	return &hiring.PipelineStage{
		ID:   hiring.PipelineStageID(dbvalue.FormatUUID(id)),
		Name: hiring.PipelineName(name.String),
		Kind: hiring.StageKind(kind.VetchiumPipelineStageKind),
	}
}

func ListApplications(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ListApplicationsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		hash, err := filtersHash(request)
		if err != nil {
			s.InternalError(r.Context(), w, "hash application filters", err)
			return
		}
		params := sqlc.ListOrgApplicationsParams{
			OrgDid: identity.OrgDID, OpeningNumber: int32(request.OpeningNumber),
			ViewerID: identity.UserID, PageLimit: int32(request.EffectiveLimit()) + 1,
		}
		switch {
		case request.View == applications.ApplicantsView:
			params.States = []string{string(applications.Submitted)}
		case request.States != nil:
			params.States = make([]string, len(request.States))
			for index, state := range request.States {
				params.States[index] = string(state)
			}
		default:
			params.States = defaultCandidateStates
		}
		if request.StageID != nil {
			stageID, err := dbvalue.ParseUUID(string(*request.StageID))
			if err != nil {
				s.InternalError(r.Context(), w, "parse stage filter", err)
				return
			}
			params.StageID = stageID
		}
		if request.NameQuery != nil {
			params.NameQuery = dbvalue.Text(string(*request.NameQuery))
		}
		if request.PendingApplicantAction != nil {
			params.PendingAction = dbvalue.Text(string(*request.PendingApplicantAction))
		}
		if request.PaginationKey != nil {
			payload, valid := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), listPaginationPurpose,
				string(*request.PaginationKey))
			var cursor listCursor
			if !valid || json.Unmarshal(payload, &cursor) != nil ||
				cursor.FiltersHash != hash ||
				cursor.OpeningNumber != request.OpeningNumber ||
				cursor.AfterApplicationNumber < 1 {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterApplicationNumber = pgtype.Int4{
				Int32: cursor.AfterApplicationNumber, Valid: true,
			}
		}
		rows, err := s.Queries.ListOrgApplications(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list applications", err)
			return
		}
		if len(rows) == 0 {
			s.Problem(r.Context(), w, orgsproblem.ApplicationNotFoundError)
			return
		}
		// A readable Opening with nothing to list yields one row without an
		// application.
		if !rows[0].ApplicationNumber.Valid {
			rows = nil
		}
		limit := int(request.EffectiveLimit())
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := applications.ListApplicationsResponse{
			Applications: make([]applications.ApplicationSummary, 0, len(rows)),
		}
		for _, row := range rows {
			response.Applications = append(response.Applications,
				applications.ApplicationSummary{
					ApplicationNumber: applications.ApplicationNumber(row.ApplicationNumber.Int32),
					State:             applications.ApplicationState(row.ApplicationState.VetchiumOrgApplicationState),
					Version:           applications.ApplicationVersion(row.Version.Int32),
					DisplayName:       common.DisplayName(row.DisplayName),
					ResidentCountry:   common.CountryCode(row.ResidentCountry),
					CurrentStage:      stagePointer(row.StageID, row.StageName, row.StageKind),
					SubmittedAt:       row.CreatedAt.Time.UTC(),
					UpdatedAt:         row.UpdatedAt.Time.UTC(),
				})
		}
		if hasMore {
			last := rows[len(rows)-1]
			payload, err := json.Marshal(listCursor{
				AfterApplicationNumber: last.ApplicationNumber.Int32,
				OpeningNumber:          request.OpeningNumber, FiltersHash: hash,
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode application cursor", err)
				return
			}
			key := common.PaginationKey(credentials.SignValue(
				s.CredentialSubkey("pagination"), listPaginationPurpose, payload))
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func calendarDate(date pgtype.Date) *applications.CalendarDate {
	if !date.Valid {
		return nil
	}
	value := applications.FormatCalendarDate(date.Time)
	return &value
}

// buildDetail maps the one row every application read and write returns.
// storedOffer is one offer as GetOrgApplication aggregates it.
type storedOffer struct {
	OfferNumber         applications.OfferNumber   `json:"offer_number"`
	Status              applications.OfferStatus   `json:"status"`
	LetterObjectID      string                     `json:"letter_object_id"`
	LetterByteSize      int32                      `json:"letter_byte_size"`
	ProposedJoiningDate *applications.CalendarDate `json:"proposed_joining_date"`
	RespondBy           time.Time                  `json:"respond_by"`
	ExtendedAt          time.Time                  `json:"extended_at"`
	EndedAt             *time.Time                 `json:"ended_at"`
}

// offers signs a fresh letter link for every offer, withdrawn ones included:
// the Opening's readers keep every letter (HP-WRK-008).
func offers(
	ctx context.Context, letters orgsruntime.OfferLetterStorage,
	stored json.RawMessage,
) ([]applications.ApplicationOffer, error) {
	var rows []storedOffer
	if err := json.Unmarshal(stored, &rows); err != nil {
		return nil, fmt.Errorf("decode offers: %w", err)
	}
	result := make([]applications.ApplicationOffer, 0, len(rows))
	for _, row := range rows {
		objectID, err := dbvalue.ParseUUID(row.LetterObjectID)
		if err != nil {
			return nil, err
		}
		letterURL, err := letters.SignOfferLetterGet(ctx, objectID)
		if err != nil {
			return nil, fmt.Errorf("sign offer letter: %w", err)
		}
		offer := applications.ApplicationOffer{
			OfferNumber: row.OfferNumber, Status: row.Status,
			LetterURL: letterURL, LetterByteSize: row.LetterByteSize,
			ProposedJoiningDate: row.ProposedJoiningDate,
			RespondBy:           row.RespondBy.UTC(),
			ExtendedAt:          row.ExtendedAt.UTC(),
		}
		if row.EndedAt != nil {
			ended := row.EndedAt.UTC()
			offer.EndedAt = &ended
		}
		result = append(result, offer)
	}
	return result, nil
}

func buildDetail(
	ctx context.Context, letters orgsruntime.OfferLetterStorage,
	opening openings.OpeningNumber, row sqlc.GetOrgApplicationRow,
) (applications.ApplicationDetail, error) {
	detail := applications.ApplicationDetail{
		OpeningNumber:     opening,
		ApplicationNumber: applications.ApplicationNumber(row.ApplicationNumber),
		State:             applications.ApplicationState(row.ApplicationState),
		Version:           applications.ApplicationVersion(row.Version),
		CurrentStage:      stagePointer(row.StageID, row.StageName, row.StageKind),
		JoinedOn:          calendarDate(row.JoinedOn),
		SeparatedOn:       calendarDate(row.SeparatedOn),
		Positions:         row.Positions,
		JoinedCount:       row.JoinedCount,
		SubmittedAt:       row.CreatedAt.Time.UTC(),
		UpdatedAt:         row.UpdatedAt.Time.UTC(),
	}
	if row.CoverNote.Valid {
		note := applications.ApplicationCoverNote(row.CoverNote.String)
		detail.CoverNote = &note
	}
	if err := json.Unmarshal(row.Snapshot, &detail.Snapshot); err != nil {
		return detail, fmt.Errorf("decode application snapshot: %w", err)
	}
	detail.Snapshot = detail.Snapshot.Normalized()
	if err := json.Unmarshal(row.StageRecords, &detail.StageRecords); err != nil {
		return detail, fmt.Errorf("decode stage records: %w", err)
	}
	list, err := offers(ctx, letters, row.Offers)
	if err != nil {
		return detail, err
	}
	detail.Offers = list
	if detail.Interviews, err = interviews(row.Interviews); err != nil {
		return detail, err
	}
	return detail, nil
}

func GetApplication(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.GetApplicationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		row, err := s.Queries.GetOrgApplication(r.Context(), sqlc.GetOrgApplicationParams{
			OrgDid: identity.OrgDID, OpeningNumber: int32(request.OpeningNumber),
			ApplicationNumber: int32(request.ApplicationNumber), ViewerID: identity.UserID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.ApplicationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get application", err)
			return
		}
		detail, err := buildDetail(r.Context(), s.OfferLetters,
			request.OpeningNumber, row)
		if err != nil {
			s.InternalError(r.Context(), w, "build application detail", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, detail)
	}
}

func GetApplicationCounts(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.GetApplicationCountsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		row, err := s.Queries.GetOrgApplicationCounts(r.Context(), sqlc.GetOrgApplicationCountsParams{
			OrgDid: identity.OrgDID, OpeningNumber: int32(request.OpeningNumber),
			ViewerID: identity.UserID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.ApplicationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "count applications", err)
			return
		}
		counts := applications.ApplicationCounts{OpeningNumber: request.OpeningNumber}
		if err := json.Unmarshal(row.States, &counts.States); err != nil {
			s.InternalError(r.Context(), w, "decode state counts", err)
			return
		}
		if err := json.Unmarshal(row.Stages, &counts.Stages); err != nil {
			s.InternalError(r.Context(), w, "decode stage counts", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, counts)
	}
}

type historyCursor struct {
	AfterCreatedAt    time.Time                      `json:"after_created_at"`
	AfterHistoryID    string                         `json:"after_history_id"`
	OpeningNumber     openings.OpeningNumber         `json:"opening_number"`
	ApplicationNumber applications.ApplicationNumber `json:"application_number"`
}

func ListApplicationHistory(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ListApplicationHistoryRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		params := sqlc.ListOrgApplicationHistoryParams{
			OrgDid: identity.OrgDID, OpeningNumber: int32(request.OpeningNumber),
			ApplicationNumber: int32(request.ApplicationNumber),
			ViewerID:          identity.UserID,
			PageLimit:         int32(request.EffectiveLimit()) + 1,
		}
		if request.PaginationKey != nil {
			payload, valid := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), historyPaginationPurpose,
				string(*request.PaginationKey))
			var cursor historyCursor
			if !valid || json.Unmarshal(payload, &cursor) != nil ||
				cursor.OpeningNumber != request.OpeningNumber ||
				cursor.ApplicationNumber != request.ApplicationNumber ||
				cursor.AfterCreatedAt.IsZero() {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			id, err := dbvalue.ParseUUID(cursor.AfterHistoryID)
			if err != nil {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterCreatedAt = dbvalue.Timestamp(cursor.AfterCreatedAt)
			params.AfterHistoryID = id
		}
		rows, err := s.Queries.ListOrgApplicationHistory(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list application history", err)
			return
		}
		if len(rows) == 0 {
			s.Problem(r.Context(), w, orgsproblem.ApplicationNotFoundError)
			return
		}
		// Applying always writes the first entry, so a readable application
		// with no entry left means the cursor reached the end.
		if !rows[0].OrgApplicationHistoryID.Valid {
			rows = nil
		}
		limit := int(request.EffectiveLimit())
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := applications.ListApplicationHistoryResponse{
			Entries: make([]applications.ApplicationHistoryEntry, 0, len(rows)),
		}
		for _, row := range rows {
			entry := applications.ApplicationHistoryEntry{
				Action:          applications.ApplicationHistoryAction(row.Action.VetchiumOrgApplicationHistoryAction),
				Actor:           applications.ApplicationActorKind(row.ActorKind.VetchiumOrgApplicationActorKind),
				State:           applications.ApplicationState(row.ApplicationState.VetchiumOrgApplicationState),
				Version:         applications.ApplicationVersion(row.ApplicationVersion.Int32),
				Stage:           stagePointer(row.StageID, row.StageName, row.StageKind),
				InterviewNumber: interviewNumber(row.InterviewNumber),
				JoinedOn:        calendarDate(row.JoinedOn),
				SeparatedOn:     calendarDate(row.SeparatedOn),
				CreatedAt:       row.CreatedAt.Time.UTC(),
			}
			if row.ActorEmail.Valid {
				email := common.EmailAddress(row.ActorEmail.String)
				entry.ActorEmail = &email
			}
			response.Entries = append(response.Entries, entry)
		}
		if hasMore {
			last := rows[len(rows)-1]
			payload, err := json.Marshal(historyCursor{
				AfterCreatedAt:    last.CreatedAt.Time.UTC(),
				AfterHistoryID:    dbvalue.FormatUUID(last.OrgApplicationHistoryID),
				OpeningNumber:     request.OpeningNumber,
				ApplicationNumber: request.ApplicationNumber,
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode history cursor", err)
				return
			}
			key := common.PaginationKey(credentials.SignValue(
				s.CredentialSubkey("pagination"), historyPaginationPurpose, payload))
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}
