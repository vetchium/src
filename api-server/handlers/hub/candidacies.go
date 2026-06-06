package hub

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	hub "vetchium-api-server.typespec/hub"
)

func parseCandidacyCursorHub(key string) (pgtype.Timestamptz, pgtype.UUID) {
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

func ListMyCandidacies(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.ListMyCandidaciesRequest
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
		if req.Limit != nil && *req.Limit > 0 && *req.Limit <= 100 {
			limit = *req.Limit
		}

		var cursorKey string
		if req.PaginationKey != nil {
			cursorKey = *req.PaginationKey
		}
		cursorTs, cursorID := parseCandidacyCursorHub(cursorKey)

		// Candidacies live in the opening's region, which may differ from the
		// candidate's home region. Fan out across every region in which this
		// candidate has hiring data, then merge by the global keyset ordering
		// (created_at DESC, candidacy_id DESC) and take the top page.
		regions, err := hubUserHiringRegions(ctx, s, hubUser.HubUserGlobalID)
		if err != nil {
			s.Logger(ctx).Error("failed to resolve hiring regions", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var rows []regionaldb.ListCandidaciesForHubUserRow
		for _, region := range regions {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			regionRows, qErr := rdb.ListCandidaciesForHubUser(ctx, regionaldb.ListCandidaciesForHubUserParams{
				HubUserGlobalID:   hubUser.HubUserGlobalID,
				CursorCreatedAt:   cursorTs,
				CursorCandidacyID: cursorID,
				Lim:               limit + 1,
			})
			if qErr != nil {
				s.Logger(ctx).Error("failed to list candidacies", "region", region, "error", qErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			rows = append(rows, regionRows...)
		}
		// Global keyset ordering across the merged regions.
		sort.Slice(rows, func(i, j int) bool {
			if !rows[i].CreatedAt.Time.Equal(rows[j].CreatedAt.Time) {
				return rows[i].CreatedAt.Time.After(rows[j].CreatedAt.Time)
			}
			return rows[i].CandidacyID.String() > rows[j].CandidacyID.String()
		})

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			last := rows[len(rows)-1]
			k := fmt.Sprintf("%s|%s",
				last.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
				last.CandidacyID.String())
			nextKey = &k
		}

		// Build summaries (org_domain/org_name requires global lookup, omitted for list)
		summaries := make([]hub.HubCandidacySummary, 0, len(rows))
		for _, row := range rows {
			summaries = append(summaries, hub.HubCandidacySummary{
				CandidacyID:      row.CandidacyID.String(),
				ApplicationID:    row.ApplicationID.String(),
				OrgDomain:        "",
				OrgName:          "",
				OpeningTitle:     row.OpeningTitle,
				State:            hub.CandidacyState(row.State),
				CreatedAt:        row.CreatedAt.Time.UTC().Format(time.RFC3339),
				StateChangedAt:   row.StateChangedAt.Time.UTC().Format(time.RFC3339),
				LatestActivityAt: row.StateChangedAt.Time.UTC().Format(time.RFC3339),
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(hub.ListMyCandidaciesResponse{
			Candidacies:       summaries,
			NextPaginationKey: nextKey,
		})
	}
}

func GetMyCandidacy(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.GetMyCandidacyRequest
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

		var candidacyID pgtype.UUID
		if err := candidacyID.Scan(req.CandidacyID); err != nil {
			http.Error(w, "invalid candidacy_id format", http.StatusBadRequest)
			return
		}

		// The candidacy lives in the opening's region. Probe the candidate's
		// hiring regions to find the owning region, then read everything there.
		regions, err := hubUserHiringRegions(ctx, s, hubUser.HubUserGlobalID)
		if err != nil {
			s.Logger(ctx).Error("failed to resolve hiring regions", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var db *regionaldb.Queries
		var row regionaldb.GetCandidacyForHubUserRow
		for _, region := range regions {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			r2, qErr := rdb.GetCandidacyForHubUser(ctx, regionaldb.GetCandidacyForHubUserParams{
				CandidacyID:              candidacyID,
				ApplicantHubUserGlobalID: hubUser.HubUserGlobalID,
			})
			if qErr == nil {
				db = rdb
				row = r2
				break
			}
			if !errors.Is(qErr, pgx.ErrNoRows) {
				s.Logger(ctx).Error("failed to get candidacy", "region", region, "error", qErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
		}
		if db == nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		comments, err := db.GetCandidacyCommentThread(ctx, candidacyID)
		if err != nil {
			s.Logger(ctx).Error("failed to get comments", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		interviews, err := db.ListInterviewsForCandidacy(ctx, candidacyID)
		if err != nil {
			s.Logger(ctx).Error("failed to get interviews", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		commentList := make([]hub.CandidacyComment, 0, len(comments))
		for _, c := range comments {
			kind := "system"
			if c.AuthorOrgUserID.Valid {
				kind = "org_user"
			} else if c.AuthorHubUserGlobalID.Valid {
				kind = "hub_user"
			}
			commentList = append(commentList, hub.CandidacyComment{
				CommentID:  c.CommentID.String(),
				AuthorKind: kind,
				Body:       c.Body,
				CreatedAt:  c.CreatedAt.Time.UTC().Format(time.RFC3339),
			})
		}

		interviewList := make([]hub.HubInterview, 0, len(interviews))
		for _, iv := range interviews {
			var candidateRSVP *hub.InterviewRSVP
			if iv.CandidateRsvp.Valid {
				v := hub.InterviewRSVP(iv.CandidateRsvp.String)
				candidateRSVP = &v
			}
			var desc *string
			if iv.Description.Valid {
				desc = &iv.Description.String
			}
			var loc *string
			if iv.Location.Valid {
				loc = &iv.Location.String
			}
			interviewList = append(interviewList, hub.HubInterview{
				InterviewID:       iv.InterviewID.String(),
				InterviewType:     hub.InterviewType(iv.InterviewType),
				StartsAt:          iv.StartsAt.Time.UTC().Format(time.RFC3339),
				EndsAt:            iv.EndsAt.Time.UTC().Format(time.RFC3339),
				Description:       desc,
				InterviewLocation: loc,
				State:             hub.InterviewState(iv.State),
				CandidateRSVP:     candidateRSVP,
				InterviewerRSVPSummary: struct {
					Total   int32 `json:"total"`
					Yes     int32 `json:"yes"`
					No      int32 `json:"no"`
					Pending int32 `json:"pending"`
				}{},
			})
		}

		// Offer (if extended). All terms live in the offer letter document, which
		// the candidate can download via the returned authenticated URL.
		var offerView *hub.HubOfferView
		if offer, oErr := db.GetOfferByCandidacyID(ctx, candidacyID); oErr == nil {
			offerView = &hub.HubOfferView{
				ExtendedAt: offer.ExtendedAt.Time.UTC().Format(time.RFC3339),
				OfferLetterDownloadURL: fmt.Sprintf(
					"/hub/offer-letter/%s", candidacyID.String()),
			}
			if offer.StartDate.Valid {
				v := offer.StartDate.Time.UTC().Format("2006-01-02")
				offerView.StartDate = &v
			}
			if offer.Notes.Valid {
				v := offer.Notes.String
				offerView.Notes = &v
			}
		} else if !errors.Is(oErr, pgx.ErrNoRows) {
			s.Logger(ctx).Error("failed to get offer", "error", oErr)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		result := hub.HubCandidacy{
			CandidacyID:    row.CandidacyID.String(),
			ApplicationID:  row.ApplicationID.String(),
			OrgDomain:      "",
			OrgName:        "",
			OpeningNumber:  row.OpeningNumber,
			OpeningTitle:   row.OpeningTitle,
			State:          hub.CandidacyState(row.State),
			CreatedAt:      row.CreatedAt.Time.UTC().Format(time.RFC3339),
			StateChangedAt: row.StateChangedAt.Time.UTC().Format(time.RFC3339),
			Interviews:     interviewList,
			Comments:       commentList,
			Offer:          offerView,
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(result)
	}
}

func RSVPInterview(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.RSVPInterviewRequest
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

		var interviewID pgtype.UUID
		if err := interviewID.Scan(req.InterviewID); err != nil {
			http.Error(w, "invalid interview_id", http.StatusBadRequest)
			return
		}

		// The interview lives in the opening's region. The interview_id is
		// globally unique but has no global index, so bound-fan-out across all
		// configured regions (≤3) to locate it independently of the caller — a
		// non-owner must reach the ownership check below (403), not a false 404.
		regions := allConfiguredRegions(s)
		var interviewRegion globaldb.Region
		var db *regionaldb.Queries
		var interview regionaldb.Interview
		for _, region := range regions {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			iv, qErr := rdb.GetInterview(ctx, interviewID)
			if qErr == nil {
				interviewRegion = region
				db = rdb
				interview = iv
				break
			}
			if !errors.Is(qErr, pgx.ErrNoRows) {
				s.Logger(ctx).Error("failed to get interview", "region", region, "error", qErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
		}
		if db == nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		candidacy, err := db.GetCandidacy(ctx, interview.CandidacyID)
		if err != nil {
			s.Logger(ctx).Error("failed to get candidacy", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if candidacy.ApplicantHubUserGlobalID != hubUser.HubUserGlobalID {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if interview.State != "scheduled" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		eventData, _ := json.Marshal(map[string]any{
			"interview_id": req.InterviewID,
			"rsvp":         string(req.RSVP),
		})
		if err := s.WithRegionalTxFor(ctx, interviewRegion, func(qtx *regionaldb.Queries) error {
			if _, txErr := qtx.SetCandidateRSVP(ctx, regionaldb.SetCandidateRSVPParams{
				InterviewID:   interviewID,
				CandidateRsvp: pgtype.Text{String: string(req.RSVP), Valid: true},
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.rsvp_interview",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to set interview RSVP", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

func AddCandidacyComment(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.AddCandidacyCommentRequest
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

		var candidacyID pgtype.UUID
		if err := candidacyID.Scan(req.CandidacyID); err != nil {
			http.Error(w, "invalid candidacy_id format", http.StatusBadRequest)
			return
		}

		// The candidacy lives in the opening's region. Probe the candidate's
		// hiring regions to find the owning region, then write the comment there.
		regions, err := hubUserHiringRegions(ctx, s, hubUser.HubUserGlobalID)
		if err != nil {
			s.Logger(ctx).Error("failed to resolve hiring regions", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var commentRegion globaldb.Region
		for _, region := range regions {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			if _, qErr := rdb.GetCandidacy(ctx, candidacyID); qErr == nil {
				commentRegion = region
				break
			} else if !errors.Is(qErr, pgx.ErrNoRows) {
				s.Logger(ctx).Error("failed to locate candidacy", "region", region, "error", qErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
		}
		if commentRegion == "" {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		eventData, _ := json.Marshal(map[string]any{"candidacy_id": req.CandidacyID})
		if err := s.WithRegionalTxFor(ctx, commentRegion, func(qtx *regionaldb.Queries) error {
			candidacy, txErr := qtx.GetCandidacy(ctx, candidacyID)
			if txErr != nil {
				return txErr
			}
			if candidacy.ApplicantHubUserGlobalID != hubUser.HubUserGlobalID {
				return server.ErrNotFound
			}
			if candidacy.State != "interviewing" && candidacy.State != "offered" {
				return server.ErrInvalidState
			}

			var emptyUUID pgtype.UUID
			if _, txErr := qtx.AddCandidacyComment(ctx, regionaldb.AddCandidacyCommentParams{
				CandidacyID:           candidacyID,
				Body:                  req.Body,
				AuthorOrgUserID:       emptyUUID,
				AuthorHubUserGlobalID: hubUser.HubUserGlobalID,
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.add_candidacy_comment",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, server.ErrNotFound) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if errors.Is(err, server.ErrInvalidState) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			s.Logger(ctx).Error("failed to add candidacy comment", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}
