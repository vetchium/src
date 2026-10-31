package applications

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/openings"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

const myInterviewsPaginationPurpose = "orgs-list-my-interviews-v2"

// A cursor holds its view, so a key from one view is refused in another. The
// views ordered by start also hold the last start.
type myInterviewsCursor struct {
	View             applications.MyInterviewView `json:"view,omitempty"`
	AfterStartsAt    time.Time                    `json:"after_starts_at,omitzero"`
	AfterInterviewID string                       `json:"after_interview_id"`
}

// ListMyInterviews lists the interviews the caller is an interviewer of, all
// of them or one view. An interviewer without other access learns of their
// candidacies here (HP-AUTH-003); the query is keyed by the caller, so it
// needs no further authorization.
func ListMyInterviews(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ListMyInterviewsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		var view applications.MyInterviewView
		if request.View != nil {
			view = *request.View
		}
		var cursor myInterviewsCursor
		var after pgtype.UUID
		if request.PaginationKey != nil {
			payload, valid := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), myInterviewsPaginationPurpose,
				string(*request.PaginationKey))
			if valid && json.Unmarshal(payload, &cursor) == nil {
				after, _ = dbvalue.ParseUUID(cursor.AfterInterviewID)
			}
			if !after.Valid || cursor.View != view ||
				(view != "") == cursor.AfterStartsAt.IsZero() {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
		}
		limit := int(request.EffectiveLimit())
		var rows []sqlc.ListOrgInterviewsForInterviewerRow
		var err error
		if view == "" {
			rows, err = s.Queries.ListOrgInterviewsForInterviewer(r.Context(),
				sqlc.ListOrgInterviewsForInterviewerParams{
					ViewerID: identity.UserID, OrgDid: identity.OrgDID,
					AfterInterviewID: after, PageLimit: int32(limit) + 1,
				})
		} else {
			params := sqlc.ListOrgInterviewsForInterviewerByStartParams{
				ViewerID: identity.UserID, OrgDid: identity.OrgDID,
				FeedbackDue:      view == applications.FeedbackDueInterviewsView,
				AfterInterviewID: after, PageLimit: int32(limit) + 1,
			}
			if after.Valid {
				params.AfterStartsAt = pgtype.Timestamptz{
					Time: cursor.AfterStartsAt, Valid: true,
				}
			}
			var started []sqlc.ListOrgInterviewsForInterviewerByStartRow
			started, err = s.Queries.ListOrgInterviewsForInterviewerByStart(
				r.Context(), params)
			for _, row := range started {
				rows = append(rows, sqlc.ListOrgInterviewsForInterviewerRow(row))
			}
		}
		if err != nil {
			s.InternalError(r.Context(), w, "list my interviews", err)
			return
		}
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := applications.ListMyInterviewsResponse{
			Interviews: make([]applications.MyInterview, 0, len(rows)),
		}
		for _, row := range rows {
			response.Interviews = append(response.Interviews, applications.MyInterview{
				OpeningNumber:     openings.OpeningNumber(row.OpeningNumber),
				ApplicationNumber: applications.ApplicationNumber(row.ApplicationNumber),
				DisplayName:       common.DisplayName(row.DisplayName),
				InterviewNumber:   applications.InterviewNumber(row.InterviewNumber),
				StartsAt:          row.StartsAt.Time.UTC(),
				DurationMinutes:   applications.InterviewDurationMinutes(row.DurationMinutes),
				Mode:              applications.InterviewMode(row.InterviewMode),
				State:             applications.InterviewState(row.InterviewState),
				ApplicantResponse: applications.InterviewResponse(row.ApplicantResponse),
				FeedbackSubmitted: row.FeedbackSubmitted,
			})
		}
		if hasMore {
			last := rows[len(rows)-1]
			next := myInterviewsCursor{
				View:             view,
				AfterInterviewID: dbvalue.FormatUUID(last.OrgInterviewID),
			}
			if view != "" {
				next.AfterStartsAt = last.StartsAt.Time
			}
			payload, err := json.Marshal(next)
			if err != nil {
				s.InternalError(r.Context(), w, "encode interview cursor", err)
				return
			}
			key := common.PaginationKey(credentials.SignValue(
				s.CredentialSubkey("pagination"), myInterviewsPaginationPurpose, payload))
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

// MyInterviewCounts reads the size of each view of the caller's interviews.
func MyInterviewCounts(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		row, err := s.Queries.CountOrgInterviewsForInterviewer(r.Context(),
			sqlc.CountOrgInterviewsForInterviewerParams{
				ViewerID: identity.UserID, OrgDid: identity.OrgDID,
			})
		if err != nil {
			s.InternalError(r.Context(), w, "count my interviews", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, applications.MyInterviewCounts{
			Upcoming: row.Upcoming, FeedbackDue: row.FeedbackDue,
		})
	}
}
