package hub

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	hub "vetchium-api-server.typespec/hub"
)

// Note: /hub/rsvp-interview is handled in handlers/hub/candidacies.go

// parseInterviewCursorAsc decodes a "<rfc3339nano>|<interview_id>" keyset cursor
// for the candidate-facing My Interviews list (ascending by start time).
func parseInterviewCursorAsc(key string) (pgtype.Timestamptz, pgtype.UUID) {
	var ts pgtype.Timestamptz
	var id pgtype.UUID
	if key == "" {
		return ts, id
	}
	parts := strings.SplitN(key, "|", 2)
	if len(parts) != 2 {
		return ts, id
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return ts, id
	}
	ts = pgtype.Timestamptz{Time: t, Valid: true}
	_ = id.Scan(parts[1])
	return ts, id
}

// ListMyInterviews returns the candidate's interviews flattened across all of
// their candidacies, soonest first. Like list-my-candidacies, interviews live
// in each opening's region, so we fan out across the candidate's hiring regions
// and merge by the global keyset ordering (starts_at ASC, interview_id ASC).
func ListMyInterviews(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.ListMyInterviewsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		limit := int32(20)
		if req.Limit != nil {
			limit = *req.Limit
		}

		var cursorKey string
		if req.PaginationKey != nil {
			cursorKey = *req.PaginationKey
		}
		cursorTs, cursorID := parseInterviewCursorAsc(cursorKey)

		var filterStates []string
		for _, st := range req.FilterState {
			filterStates = append(filterStates, string(st))
		}

		regions, err := hubUserHiringRegions(ctx, s, hubUser.HubUserGlobalID)
		if err != nil {
			s.Logger(ctx).Error("failed to resolve hiring regions", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var rows []regionaldb.ListMyInterviewsForHubUserRow
		for _, region := range regions {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			regionRows, qErr := rdb.ListMyInterviewsForHubUser(ctx, regionaldb.ListMyInterviewsForHubUserParams{
				HubUserGlobalID:   hubUser.HubUserGlobalID,
				FilterStates:      filterStates,
				CursorStartsAt:    cursorTs,
				CursorInterviewID: cursorID,
				Lim:               limit + 1,
			})
			if qErr != nil {
				s.Logger(ctx).Error("failed to list interviews", "region", region, "error", qErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			rows = append(rows, regionRows...)
		}

		// Global keyset ordering across the merged regions: soonest first,
		// interview_id ascending as the tiebreaker (matches the SQL ORDER BY).
		sort.Slice(rows, func(i, j int) bool {
			if !rows[i].StartsAt.Time.Equal(rows[j].StartsAt.Time) {
				return rows[i].StartsAt.Time.Before(rows[j].StartsAt.Time)
			}
			return rows[i].InterviewID.String() < rows[j].InterviewID.String()
		})

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			last := rows[len(rows)-1]
			k := fmt.Sprintf("%s|%s",
				last.StartsAt.Time.UTC().Format(time.RFC3339Nano),
				last.InterviewID.String())
			nextKey = &k
		}

		interviews := make([]hub.HubMyInterview, 0, len(rows))
		for _, row := range rows {
			var candidateRSVP *hub.InterviewRSVP
			if row.CandidateRsvp.Valid {
				v := hub.InterviewRSVP(row.CandidateRsvp.String)
				candidateRSVP = &v
			}
			interviews = append(interviews, hub.HubMyInterview{
				InterviewID:   row.InterviewID.String(),
				CandidacyID:   row.CandidacyID.String(),
				OpeningTitle:  row.OpeningTitle,
				InterviewType: hub.InterviewType(row.InterviewType),
				StartsAt:      row.StartsAt.Time.UTC().Format(time.RFC3339),
				EndsAt:        row.EndsAt.Time.UTC().Format(time.RFC3339),
				State:         hub.InterviewState(row.State),
				CandidateRSVP: candidateRSVP,
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(hub.ListMyInterviewsResponse{
			Interviews:        interviews,
			NextPaginationKey: nextKey,
		})
	}
}
