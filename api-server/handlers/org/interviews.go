package org

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	org "vetchium-api-server.typespec/org"
)

func ScheduleInterview(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.ScheduleInterviewRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
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
			http.Error(w, "invalid candidacy_id", http.StatusBadRequest)
			return
		}

		startsAt, err := time.Parse(time.RFC3339, req.StartsAt)
		if err != nil {
			http.Error(w, "invalid starts_at format, use RFC3339", http.StatusBadRequest)
			return
		}
		endsAt, err := time.Parse(time.RFC3339, req.EndsAt)
		if err != nil {
			http.Error(w, "invalid ends_at format, use RFC3339", http.StatusBadRequest)
			return
		}
		if !endsAt.After(startsAt) {
			http.Error(w, "ends_at must be after starts_at", http.StatusBadRequest)
			return
		}

		db := s.RegionalForCtx(ctx)

		// Validate candidacy ownership and state
		candidacy, err := db.GetCandidacy(ctx, candidacyID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get candidacy", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if candidacy.OrgID != orgUser.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if candidacy.State != "interviewing" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Resolve interviewer email addresses to org user IDs (one round-trip with all emails)
		interviewerIDs := make([]pgtype.UUID, 0, len(req.InterviewerEmailAddresses))
		for _, email := range req.InterviewerEmailAddresses {
			u, err := db.GetOrgUserByEmailAndOrg(ctx, regionaldb.GetOrgUserByEmailAndOrgParams{
				EmailAddress: email,
				OrgID:        orgUser.OrgID,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					http.Error(w, "interviewer not found: "+email, http.StatusBadRequest)
					return
				}
				log.Error("failed to look up interviewer", "error", err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			interviewerIDs = append(interviewerIDs, u.OrgUserID)
		}

		eventData, _ := json.Marshal(map[string]interface{}{"candidacy_id": req.CandidacyID})
		var interview regionaldb.Interview
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var descText pgtype.Text
			if req.Description != nil {
				descText.Scan(*req.Description)
			}

			var txErr error
			interview, txErr = qtx.ScheduleInterview(ctx, regionaldb.ScheduleInterviewParams{
				CandidacyID:   candidacyID,
				InterviewType: string(req.InterviewType),
				StartsAt:      pgtype.Timestamptz{Time: startsAt, Valid: true},
				EndsAt:        pgtype.Timestamptz{Time: endsAt, Valid: true},
				Description:   descText,
				CreatedBy:     orgUser.OrgUserID,
			})
			if txErr != nil {
				return txErr
			}

			for _, uid := range interviewerIDs {
				if txErr := qtx.AddInterviewer(ctx, regionaldb.AddInterviewerParams{
					InterviewID: interview.InterviewID,
					OrgUserID:   uid,
				}); txErr != nil {
					return txErr
				}
			}

			if txErr := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.schedule_interview",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			}); txErr != nil {
				return txErr
			}

			// Notify candidate of scheduled interview
			cand, _ := qtx.GetCandidacy(ctx, interview.CandidacyID)
			hubUser, _ := qtx.GetHubUserByGlobalID(ctx, cand.ApplicantHubUserGlobalID)
			if hubUser.EmailAddress != "" {
				_, _ = qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
					EmailType:     regionaldb.EmailTemplateTypeHubInterviewScheduled,
					EmailTo:       hubUser.EmailAddress,
					EmailSubject:  "Interview scheduled",
					EmailTextBody: fmt.Sprintf("An interview has been scheduled: %s %s - %s", string(req.InterviewType), req.StartsAt, req.EndsAt),
					EmailHtmlBody: fmt.Sprintf("<p>An interview has been scheduled.</p><p>Type: %s<br/>Start: %s<br/>End: %s</p>", req.InterviewType, req.StartsAt, req.EndsAt),
				})
			}
			return nil
		}); err != nil {
			log.Error("failed to schedule interview", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(org.ScheduleInterviewResponse{
			InterviewID: interview.InterviewID.String(),
		})
	}
}

func UpdateInterview(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.UpdateInterviewRequest
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

		db := s.RegionalForCtx(ctx)
		existing, err := db.GetInterview(ctx, interviewID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get interview", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if existing.State != "scheduled" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Verify org ownership via candidacy
		candidacy, err := db.GetCandidacy(ctx, existing.CandidacyID)
		if err != nil {
			s.Logger(ctx).Error("failed to get candidacy", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if candidacy.OrgID != orgUser.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		// Build update params (use existing values if not provided)
		startsAt := existing.StartsAt
		endsAt := existing.EndsAt
		if req.StartsAt != nil {
			t, err := time.Parse(time.RFC3339, *req.StartsAt)
			if err != nil {
				http.Error(w, "invalid starts_at format", http.StatusBadRequest)
				return
			}
			startsAt = pgtype.Timestamptz{Time: t, Valid: true}
		}
		if req.EndsAt != nil {
			t, err := time.Parse(time.RFC3339, *req.EndsAt)
			if err != nil {
				http.Error(w, "invalid ends_at format", http.StatusBadRequest)
				return
			}
			endsAt = pgtype.Timestamptz{Time: t, Valid: true}
		}
		if endsAt.Time.Before(startsAt.Time) || endsAt.Time.Equal(startsAt.Time) {
			http.Error(w, "ends_at must be after starts_at", http.StatusBadRequest)
			return
		}

		descText := existing.Description
		if req.Description != nil {
			descText.Scan(*req.Description)
		}

		eventData, _ := json.Marshal(map[string]interface{}{"interview_id": req.InterviewID})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if _, txErr := qtx.UpdateInterview(ctx, regionaldb.UpdateInterviewParams{
				InterviewID: interviewID,
				StartsAt:    startsAt,
				EndsAt:      endsAt,
				Description: descText,
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.update_interview",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to update interview", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

func CancelInterview(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.InterviewIDRequest
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

		db := s.RegionalForCtx(ctx)
		existing, err := db.GetInterview(ctx, interviewID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get interview", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		candidacy, err := db.GetCandidacy(ctx, existing.CandidacyID)
		if err != nil {
			s.Logger(ctx).Error("failed to get candidacy", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if candidacy.OrgID != orgUser.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		eventData, _ := json.Marshal(map[string]interface{}{"interview_id": req.InterviewID})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			_, txErr := qtx.CancelInterview(ctx, interviewID)
			if txErr != nil {
				if errors.Is(txErr, pgx.ErrNoRows) {
					return server.ErrInvalidState
				}
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.cancel_interview",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			if errors.Is(err, server.ErrInvalidState) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			s.Logger(ctx).Error("failed to cancel interview", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

func AddInterviewer(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.AddInterviewerRequest
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

		db := s.RegionalForCtx(ctx)
		existing, err := db.GetInterview(ctx, interviewID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get interview", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if existing.State != "scheduled" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		candidacy, err := db.GetCandidacy(ctx, existing.CandidacyID)
		if err != nil {
			s.Logger(ctx).Error("failed to get candidacy", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if candidacy.OrgID != orgUser.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		newUser, err := db.GetOrgUserByEmailAndOrg(ctx, regionaldb.GetOrgUserByEmailAndOrgParams{
			EmailAddress: req.OrgUserEmailAddress,
			OrgID:        orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				http.Error(w, "org user not found", http.StatusBadRequest)
				return
			}
			s.Logger(ctx).Error("failed to get org user", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		count, err := db.CountInterviewersForInterview(ctx, interviewID)
		if err != nil {
			s.Logger(ctx).Error("failed to count interviewers", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if count >= 5 {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		eventData, _ := json.Marshal(map[string]interface{}{
			"interview_id": req.InterviewID,
			"org_user_id":  newUser.OrgUserID.String(),
		})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.AddInterviewer(ctx, regionaldb.AddInterviewerParams{
				InterviewID: interviewID,
				OrgUserID:   newUser.OrgUserID,
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.add_interviewer",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to add interviewer", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

func RemoveInterviewer(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.RemoveInterviewerRequest
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
		var removeUserID pgtype.UUID
		if err := removeUserID.Scan(req.OrgUserID); err != nil {
			http.Error(w, "invalid org_user_id", http.StatusBadRequest)
			return
		}

		db := s.RegionalForCtx(ctx)
		existing, err := db.GetInterview(ctx, interviewID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get interview", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if existing.State != "scheduled" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		candidacy, err := db.GetCandidacy(ctx, existing.CandidacyID)
		if err != nil {
			s.Logger(ctx).Error("failed to get candidacy", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if candidacy.OrgID != orgUser.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		eventData, _ := json.Marshal(map[string]interface{}{
			"interview_id": req.InterviewID,
			"org_user_id":  req.OrgUserID,
		})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.RemoveInterviewer(ctx, regionaldb.RemoveInterviewerParams{
				InterviewID: interviewID,
				OrgUserID:   removeUserID,
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.remove_interviewer",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to remove interviewer", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

func SubmitInterviewFeedback(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.SubmitInterviewFeedbackRequest
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

		db := s.RegionalForCtx(ctx)
		existing, err := db.GetInterview(ctx, interviewID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get interview", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if existing.State == "cancelled" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Verify caller is listed as an interviewer — NO role bypass, even superadmin
		_, err = db.GetInterviewerEntry(ctx, regionaldb.GetInterviewerEntryParams{
			InterviewID: interviewID,
			OrgUserID:   orgUser.OrgUserID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			s.Logger(ctx).Error("failed to get interviewer entry", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var candidateFeedback pgtype.Text
		if req.CandidateFeedback != nil {
			candidateFeedback.Scan(*req.CandidateFeedback)
		}

		eventData, _ := json.Marshal(map[string]interface{}{"interview_id": req.InterviewID})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if _, txErr := qtx.SubmitInterviewFeedback(ctx, regionaldb.SubmitInterviewFeedbackParams{
				InterviewID:          interviewID,
				InterviewerOrgUserID: orgUser.OrgUserID,
				Decision:             string(req.Decision),
				Positives:            req.Positives,
				Negatives:            req.Negatives,
				OverallAssessment:    req.OverallAssessment,
				CandidateFeedback:    candidateFeedback,
			}); txErr != nil {
				return txErr
			}

			if _, txErr := qtx.CompleteInterview(ctx, interviewID); txErr != nil {
				return txErr
			}

			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.submit_interview_feedback",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to submit feedback", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

func ListInterviews(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.ListInterviewsRequest
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

		db := s.RegionalForCtx(ctx)
		var interviews []regionaldb.Interview

		if req.FilterCandidacyID != nil && *req.FilterCandidacyID != "" {
			var candidacyID pgtype.UUID
			if err := candidacyID.Scan(*req.FilterCandidacyID); err != nil {
				http.Error(w, "invalid filter_candidacy_id", http.StatusBadRequest)
				return
			}
			// Verify ownership
			candidacy, err := db.GetCandidacy(ctx, candidacyID)
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
			var err2 error
			interviews, err2 = db.ListInterviewsForCandidacy(ctx, candidacyID)
			if err2 != nil {
				s.Logger(ctx).Error("failed to list interviews", "error", err2)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
		} else {
			interviews = []regionaldb.Interview{}
		}

		summaries := make([]org.OrgInterviewSummary, 0, len(interviews))
		for _, iv := range interviews {
			count, _ := db.CountInterviewersForInterview(ctx, iv.InterviewID)
			feedbackCount, _ := db.CountFeedbackForInterview(ctx, iv.InterviewID)

			var candidateRSVP *org.InterviewRSVP
			if iv.CandidateRsvp.Valid {
				v := org.InterviewRSVP(iv.CandidateRsvp.String)
				candidateRSVP = &v
			}

			summaries = append(summaries, org.OrgInterviewSummary{
				InterviewID:            iv.InterviewID.String(),
				InterviewType:          org.InterviewType(iv.InterviewType),
				StartsAt:               iv.StartsAt.Time.UTC().Format(time.RFC3339),
				EndsAt:                 iv.EndsAt.Time.UTC().Format(time.RFC3339),
				State:                  org.InterviewState(iv.State),
				InterviewerCount:       int32(count),
				CandidateRSVP:          candidateRSVP,
				FeedbackSubmittedCount: int32(feedbackCount),
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(org.ListInterviewsResponse{
			Interviews: summaries,
		})
	}
}

func GetInterview(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.InterviewIDRequest
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

		db := s.RegionalForCtx(ctx)
		row, err := db.GetInterviewWithInterviewers(ctx, interviewID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get interview", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Verify org ownership
		candidacy, err := db.GetCandidacy(ctx, row.CandidacyID)
		if err != nil {
			s.Logger(ctx).Error("failed to get candidacy", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if candidacy.OrgID != orgUser.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		var candidateRSVP *org.InterviewRSVP
		if row.CandidateRsvp.Valid {
			v := org.InterviewRSVP(row.CandidateRsvp.String)
			candidateRSVP = &v
		}
		var description *string
		if row.Description.Valid {
			description = &row.Description.String
		}

		result := org.OrgInterview{
			InterviewID:   row.InterviewID.String(),
			CandidacyID:   row.CandidacyID.String(),
			InterviewType: org.InterviewType(row.InterviewType),
			StartsAt:      row.StartsAt.Time.UTC().Format(time.RFC3339),
			EndsAt:        row.EndsAt.Time.UTC().Format(time.RFC3339),
			Description:   description,
			State:         org.InterviewState(row.State),
			CandidateRSVP: candidateRSVP,
			Interviewers:  []org.InterviewerEntry{},
			Feedback:      []org.InterviewFeedback{},
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(result)
	}
}

func RSVPInterview(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.SetInterviewerRSVPRequest
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

		db := s.RegionalForCtx(ctx)
		existing, err := db.GetInterview(ctx, interviewID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get interview", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if existing.State != "scheduled" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Interviewer membership check — no role bypass
		_, err = db.GetInterviewerEntry(ctx, regionaldb.GetInterviewerEntryParams{
			InterviewID: interviewID,
			OrgUserID:   orgUser.OrgUserID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			s.Logger(ctx).Error("failed to get interviewer entry", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		eventData, _ := json.Marshal(map[string]interface{}{
			"interview_id": req.InterviewID,
			"rsvp":         string(req.RSVP),
		})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if _, txErr := qtx.SetInterviewerRSVP(ctx, regionaldb.SetInterviewerRSVPParams{
				InterviewID: interviewID,
				OrgUserID:   orgUser.OrgUserID,
				Rsvp:        pgtype.Text{String: string(req.RSVP), Valid: true},
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.rsvp_interview",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to set interviewer RSVP", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}
