package applications

import (
	"encoding/json"
	"net/http"

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

const myInterviewsPaginationPurpose = "orgs-list-my-interviews-v1"

type myInterviewsCursor struct {
	AfterInterviewID string `json:"after_interview_id"`
}

// ListMyInterviews lists the interviews the caller is an interviewer of. An
// interviewer without other access learns of their candidacies here
// (HP-AUTH-003); the query is keyed by the caller, so it needs no further
// authorization.
func ListMyInterviews(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ListMyInterviewsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		params := sqlc.ListOrgInterviewsForInterviewerParams{
			ViewerID: identity.UserID, OrgDid: identity.OrgDID,
			PageLimit: int32(request.EffectiveLimit()) + 1,
		}
		if request.PaginationKey != nil {
			payload, valid := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), myInterviewsPaginationPurpose,
				string(*request.PaginationKey))
			var cursor myInterviewsCursor
			if !valid || json.Unmarshal(payload, &cursor) != nil {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			after, err := dbvalue.ParseUUID(cursor.AfterInterviewID)
			if err != nil {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterInterviewID = after
		}
		rows, err := s.Queries.ListOrgInterviewsForInterviewer(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list my interviews", err)
			return
		}
		limit := int(request.EffectiveLimit())
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
			payload, err := json.Marshal(myInterviewsCursor{
				AfterInterviewID: dbvalue.FormatUUID(rows[len(rows)-1].OrgInterviewID),
			})
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
