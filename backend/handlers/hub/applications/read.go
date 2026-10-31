package applications

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	hubspec "github.com/vetchium/src/typespec/hub"
	applicationspec "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/orgs"
	orgapplications "github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/openings"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	hubruntime "backend/internal/hub"
	"backend/internal/hubapplications"
	"backend/internal/middleware"
)

const listPaginationPurpose = "hub-list-my-applications-v2"

type listCursor struct {
	View              applicationspec.MyApplicationView `json:"view"`
	AfterActivityAt   time.Time                         `json:"after_activity_at"`
	AfterProjectionID string                            `json:"after_projection_id"`
}

// List reads one view of this tenant's projection, newest activity first. It
// may trail the Org's tenant until the latest change is delivered.
func List(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applicationspec.ListMyApplicationsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		params := sqlc.ListHubApplicationProjectionsParams{
			HubUserDid: identity.UserDID,
			Closed:     request.View == applicationspec.ClosedView,
			PageLimit:  request.EffectiveLimit() + 1,
		}
		if request.PaginationKey != nil {
			payload, valid := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), listPaginationPurpose,
				string(*request.PaginationKey))
			var cursor listCursor
			var after pgtype.UUID
			if valid && json.Unmarshal(payload, &cursor) == nil {
				after, _ = dbvalue.ParseUUID(cursor.AfterProjectionID)
			}
			if !after.Valid || cursor.AfterActivityAt.IsZero() ||
				cursor.View != request.View {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterActivityAt = dbvalue.Timestamp(cursor.AfterActivityAt)
			params.AfterProjectionID = after
		}
		rows, err := s.Queries.ListHubApplicationProjections(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list Hub applications", err)
			return
		}
		response := applicationspec.ListMyApplicationsResponse{
			Applications: []applicationspec.MyApplicationSummary{},
		}
		for index, row := range rows {
			if int32(index) == request.EffectiveLimit() {
				last := rows[index-1]
				payload, err := json.Marshal(listCursor{
					View:              request.View,
					AfterActivityAt:   last.LastActivityAt.Time,
					AfterProjectionID: dbvalue.FormatUUID(last.ProjectionID),
				})
				if err != nil {
					s.InternalError(r.Context(), w, "encode pagination key", err)
					return
				}
				key := common.PaginationKey(credentials.SignValue(
					s.CredentialSubkey("pagination"), listPaginationPurpose,
					payload))
				response.NextPaginationKey = &key
				break
			}
			response.Applications = append(response.Applications,
				projectedSummary(sqlc.FindHubApplicationProjectionForOpeningRow{
					OrgDomain:         row.OrgDomain,
					OrgDisplayName:    row.OrgDisplayName,
					OpeningNumber:     row.OpeningNumber,
					OpeningTitle:      row.OpeningTitle,
					ApplicationNumber: row.ApplicationNumber,
					HubStatus:         row.HubStatus,
					PendingActions:    row.PendingActions,
					AppliedAt:         row.AppliedAt,
					LastActivityAt:    row.LastActivityAt,
				}))
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

// Counts reads the size of each view of the list from the same projection.
func Counts(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		row, err := s.Queries.CountHubApplicationProjections(r.Context(),
			identity.UserDID)
		if err != nil {
			s.InternalError(r.Context(), w, "count Hub applications", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, applicationspec.MyApplicationCounts{
			Active: row.Active, Closed: row.Closed,
			AwaitingAnswer: row.AwaitingAnswer,
		})
	}
}

// FindForOpening reads the caller's application to one Opening from the
// projection, so an Opening page knows it without reading the whole list.
func FindForOpening(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applicationspec.FindMyOpeningApplicationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		row, err := s.Queries.FindHubApplicationProjectionForOpening(
			r.Context(), sqlc.FindHubApplicationProjectionForOpeningParams{
				HubUserDid:    identity.UserDID,
				OrgDomain:     string(request.Domain),
				OpeningNumber: int32(request.OpeningNumber),
			})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, hubproblem.ApplicationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "find Hub application", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, projectedSummary(row))
	}
}

func projectedSummary(
	row sqlc.FindHubApplicationProjectionForOpeningRow,
) applicationspec.MyApplicationSummary {
	actions := make([]applicationspec.PendingActionKind,
		len(row.PendingActions))
	for i, action := range row.PendingActions {
		actions[i] = applicationspec.PendingActionKind(action)
	}
	return applicationspec.MyApplicationSummary{
		MyApplication: applicationspec.MyApplication{
			OrgDomain:         orgs.OrgDomain(row.OrgDomain),
			OrgDisplayName:    common.DisplayName(row.OrgDisplayName),
			OpeningNumber:     openings.OpeningNumber(row.OpeningNumber),
			OpeningTitle:      row.OpeningTitle,
			ApplicationNumber: orgapplications.ApplicationNumber(row.ApplicationNumber),
			Status:            applicationspec.ApplicationStatus(row.HubStatus),
			PendingActions:    actions,
		},
		AppliedAt:      row.AppliedAt.Time.UTC(),
		LastActivityAt: row.LastActivityAt.Time.UTC(),
	}
}

// Get reads the application live: in process for an Org this tenant homes,
// otherwise from the Org's home tenant through the relay, bounded by the
// relay's deadline. It never falls back to the projection.
func Get(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applicationspec.GetMyApplicationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		read := applicationspec.MeshGetApplicationRequest{
			ApplicationReference: request,
			ApplicantDID: hubspec.HubUserDID(
				dbvalue.FormatUUID(identity.UserDID),
			),
		}
		_, err := s.Queries.GetLocalOrgForDomain(r.Context(),
			string(request.Domain))
		if err == nil {
			application, err := hubapplications.ReadForApplicant(
				r.Context(), s.Queries, s.OfferLetters, read,
			)
			if errors.Is(err, hubapplications.ErrNotFound) {
				s.Problem(r.Context(), w, hubproblem.ApplicationNotFoundError)
				return
			}
			if err != nil {
				s.InternalError(r.Context(), w, "read local application", err)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			s.JSON(r.Context(), w, http.StatusOK, application)
			return
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			s.InternalError(r.Context(), w, "read local Org domain", err)
			return
		}
		outcome, err := s.Applications.RelayGet(r.Context(), read)
		if err != nil {
			s.WarnContext(r.Context(), "Hub application relay read failed",
				"event", "hub_application_unavailable", "error", err)
			s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
			return
		}
		if outcome.Problem != nil {
			if outcome.Problem.Type == hubproblem.ApplicationNotFoundError.Type {
				s.Problem(r.Context(), w, hubproblem.ApplicationNotFoundError)
			} else {
				s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
			}
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, outcome.Result)
	}
}
