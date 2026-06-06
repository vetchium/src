package org

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	org "vetchium-api-server.typespec/org"
)

func parseCandidacyCursor(key string) (pgtype.Timestamptz, pgtype.UUID) {
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

func ListCandidacies(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.ListCandidaciesRequest
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
		cursorTs, cursorID := parseCandidacyCursor(cursorKey)

		candidacies, err := s.RegionalForCtx(ctx).ListCandidaciesForOrg(ctx, regionaldb.ListCandidaciesForOrgParams{
			OrgID:             orgUser.OrgID,
			Lim:               limit + 1,
			CursorCreatedAt:   cursorTs,
			CursorCandidacyID: cursorID,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to list candidacies", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(candidacies)) > limit {
			candidacies = candidacies[:limit]
			last := candidacies[len(candidacies)-1]
			k := fmt.Sprintf("%s|%s", last.CreatedAt.Time.UTC().Format(time.RFC3339Nano), last.CandidacyID.String())
			nextKey = &k
		}

		summaries := make([]org.OrgCandidacySummary, 0, len(candidacies))
		for _, c := range candidacies {
			summaries = append(summaries, org.OrgCandidacySummary{
				CandidacyID:             c.CandidacyID.String(),
				ApplicationID:           c.ApplicationID.String(),
				OpeningID:               c.OpeningID.String(),
				CandidateHandle:         c.ApplicantHandleSnapshot,
				CandidateDisplayName:    c.ApplicantDisplayNameSnapshot,
				State:                   org.CandidacyState(c.State),
				ScheduledInterviewCount: c.ScheduledInterviewCount,
				CreatedAt:               c.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
				StateChangedAt:          c.StateChangedAt.Time.UTC().Format(time.RFC3339Nano),
			})
		}

		resp := org.ListCandidaciesResponse{
			Candidacies:       summaries,
			NextPaginationKey: nextKey,
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
	}
}

func GetCandidacy(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.CandidacyIDRequest
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

		db := s.RegionalForCtx(ctx)
		candidacy, err := db.GetCandidacyDetailForOrg(ctx, candidacyID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get candidacy", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		if candidacy.OrgID != orgUser.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		comments, err := db.GetCandidacyCommentThread(ctx, candidacyID)
		if err != nil {
			s.Logger(ctx).Error("failed to get comments", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		commentList := make([]org.CandidacyComment, 0, len(comments))
		for _, c := range comments {
			kind := "system"
			if c.AuthorOrgUserID.Valid {
				kind = "org_user"
			} else if c.AuthorHubUserGlobalID.Valid {
				kind = "hub_user"
			}
			commentList = append(commentList, org.CandidacyComment{
				CommentID:  c.CommentID.String(),
				AuthorKind: kind,
				Body:       c.Body,
				CreatedAt:  c.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
			})
		}

		interviewRows, err := db.ListInterviewSummariesForCandidacy(ctx, candidacyID)
		if err != nil {
			s.Logger(ctx).Error("failed to list interviews", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		interviews := make([]org.OrgInterviewSummary, 0, len(interviewRows))
		for _, iv := range interviewRows {
			summary := org.OrgInterviewSummary{
				InterviewID:            iv.InterviewID.String(),
				InterviewType:          org.InterviewType(iv.InterviewType),
				StartsAt:               iv.StartsAt.Time.UTC().Format(time.RFC3339Nano),
				EndsAt:                 iv.EndsAt.Time.UTC().Format(time.RFC3339Nano),
				State:                  org.InterviewState(iv.State),
				InterviewerCount:       iv.InterviewerCount,
				FeedbackSubmittedCount: iv.FeedbackSubmittedCount,
			}
			if iv.CandidateRsvp.Valid {
				rsvp := org.InterviewRSVP(iv.CandidateRsvp.String)
				summary.CandidateRSVP = &rsvp
			}
			interviews = append(interviews, summary)
		}

		var offerView *org.OrgOfferView
		offer, err := db.GetOfferByCandidacyID(ctx, candidacyID)
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Error("failed to get offer", "error", err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
		} else {
			offerView = &org.OrgOfferView{
				ExtendedByOrgUserID:    offer.ExtendedByOrgUserID.String(),
				ExtendedAt:             offer.ExtendedAt.Time.UTC().Format(time.RFC3339Nano),
				OfferLetterDownloadURL: fmt.Sprintf("/org/offer-letter/%s", candidacyID.String()),
			}
			if offer.StartDate.Valid {
				v := offer.StartDate.Time.UTC().Format("2006-01-02")
				offerView.StartDate = &v
			}
			if offer.Notes.Valid {
				v := offer.Notes.String
				offerView.Notes = &v
			}
		}

		// Pull the cover letter from the originating application so HR sees it on
		// the candidacy page without navigating back to Applications.
		coverLetter := ""
		if app, aErr := db.GetApplicationByID(ctx, candidacy.ApplicationID); aErr == nil {
			coverLetter = app.CoverLetter
		}

		result := org.OrgCandidacy{
			CandidacyID:          candidacy.CandidacyID.String(),
			ApplicationID:        candidacy.ApplicationID.String(),
			OpeningID:            candidacy.OpeningID.String(),
			OpeningTitle:         candidacy.OpeningTitle,
			CandidateHandle:      candidacy.ApplicantHandleSnapshot,
			CandidateDisplayName: candidacy.ApplicantDisplayNameSnapshot,
			CoverLetter:          coverLetter,
			ResumeDownloadURL:    fmt.Sprintf("/org/candidacy-resume/%s", candidacyID.String()),
			State:                org.CandidacyState(candidacy.State),
			CreatedAt:            candidacy.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
			StateChangedAt:       candidacy.StateChangedAt.Time.UTC().Format(time.RFC3339Nano),
			Interviews:           interviews,
			Comments:             commentList,
			Offer:                offerView,
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(result)
	}
}

func AddCandidacyComment(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.OrgAddCandidacyCommentRequest
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

		eventData, _ := json.Marshal(map[string]interface{}{"candidacy_id": req.CandidacyID})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			candidacy, txErr := qtx.GetCandidacy(ctx, candidacyID)
			if txErr != nil {
				return txErr
			}
			if candidacy.OrgID != orgUser.OrgID {
				return server.ErrNotFound
			}
			if candidacy.State != "interviewing" && candidacy.State != "offered" {
				return server.ErrInvalidState
			}

			var emptyUUID pgtype.UUID
			if _, txErr := qtx.AddCandidacyComment(ctx, regionaldb.AddCandidacyCommentParams{
				CandidacyID:           candidacyID,
				Body:                  req.Body,
				AuthorOrgUserID:       orgUser.OrgUserID,
				AuthorHubUserGlobalID: emptyUUID,
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.add_candidacy_comment",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
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
