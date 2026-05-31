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
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	org "vetchium-api-server.typespec/org"
)

func parseCursor(key string) (pgtype.Timestamptz, pgtype.UUID) {
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

func ListApplications(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.ListApplicationsRequest
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

		var openingID pgtype.UUID
		if err := openingID.Scan(req.OpeningID); err != nil {
			http.Error(w, "invalid opening_id format", http.StatusBadRequest)
			return
		}

		db := s.RegionalForCtx(ctx)
		// Verify opening belongs to this org
		_, err := db.GetOpeningByID(ctx, regionaldb.GetOpeningByIDParams{
			OpeningID: openingID,
			OrgID:     orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get opening", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var cursorKey string
		if req.PaginationKey != nil {
			cursorKey = *req.PaginationKey
		}
		cursorTs, cursorID := parseCursor(cursorKey)

		apps, err := db.ListApplicationsForOpening(ctx, regionaldb.ListApplicationsForOpeningParams{
			OpeningID:           openingID,
			Lim:                 limit + 1,
			CursorAppliedAt:     cursorTs,
			CursorApplicationID: cursorID,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to list applications", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(apps)) > limit {
			apps = apps[:limit]
			last := apps[len(apps)-1]
			k := fmt.Sprintf("%s|%s", last.AppliedAt.Time.UTC().Format(time.RFC3339Nano), last.ApplicationID.String())
			nextKey = &k
		}

		summaries := make([]org.OrgApplicationSummary, 0, len(apps))
		for _, a := range apps {
			var label *org.ApplicationColorLabel
			if a.Label.Valid {
				l := org.ApplicationColorLabel(a.Label.String)
				label = &l
			}
			summaries = append(summaries, org.OrgApplicationSummary{
				ApplicationID:        a.ApplicationID.String(),
				CandidateHandle:      a.ApplicantHandleSnapshot,
				CandidateDisplayName: a.ApplicantDisplayNameSnapshot,
				YOETotal:             0,
				EndorsementCount:     0,
				HasReferral:          false,
				State:                org.ApplicationState(a.State),
				Label:                label,
				AppliedAt:            a.AppliedAt.Time.UTC().Format(time.RFC3339Nano),
			})
		}

		resp := org.ListApplicationsResponse{
			Applications:      summaries,
			NextPaginationKey: nextKey,
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
	}
}

func GetApplication(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.ApplicationIDRequest
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

		var appID pgtype.UUID
		if err := appID.Scan(req.ApplicationID); err != nil {
			http.Error(w, "invalid application_id format", http.StatusBadRequest)
			return
		}

		app, err := s.RegionalForCtx(ctx).GetApplicationByID(ctx, appID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get application", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		if app.OrgID != orgUser.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		var label *org.ApplicationColorLabel
		if app.Label.Valid {
			l := org.ApplicationColorLabel(app.Label.String)
			label = &l
		}

		result := org.OrgApplication{
			ApplicationID:           app.ApplicationID.String(),
			OpeningID:               app.OpeningID.String(),
			CandidateHandle:         app.ApplicantHandleSnapshot,
			CandidateDisplayName:    app.ApplicantDisplayNameSnapshot,
			CandidateEmployerStints: []interface{}{},
			CoverLetter:             app.CoverLetter,
			ResumeDownloadURL:       "",
			State:                   org.ApplicationState(app.State),
			Label:                   label,
			AppliedAt:               app.AppliedAt.Time.UTC().Format(time.RFC3339Nano),
			StateChangedAt:          app.StateChangedAt.Time.UTC().Format(time.RFC3339Nano),
			Endorsements:            []org.OrgVisibleEndorsement{},
			NotifyColleaguesUsed:    app.NotifyColleaguesAtTarget,
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(result)
	}
}

func ShortlistApplication(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.ShortlistApplicationRequest
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

		var appID pgtype.UUID
		if err := appID.Scan(req.ApplicationID); err != nil {
			http.Error(w, "invalid application_id format", http.StatusBadRequest)
			return
		}

		eventData, _ := json.Marshal(map[string]interface{}{"application_id": req.ApplicationID})
		var candidacy regionaldb.Candidacy
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			app, txErr := qtx.GetApplicationByID(ctx, appID)
			if txErr != nil {
				return txErr
			}
			if app.OrgID != orgUser.OrgID {
				return server.ErrNotFound
			}
			if app.State != "applied" {
				return server.ErrInvalidState
			}

			if txErr := qtx.ShortlistApplication(ctx, appID); txErr != nil {
				return txErr
			}

			var txErr2 error
			candidacy, txErr2 = qtx.CreateCandidacy(ctx, regionaldb.CreateCandidacyParams{
				ApplicationID:            appID,
				OrgID:                    orgUser.OrgID,
				OpeningID:                app.OpeningID,
				ApplicantHubUserGlobalID: app.ApplicantHubUserGlobalID,
				State:                    "interviewing",
			})
			if txErr2 != nil {
				return txErr2
			}

			if txErr := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.shortlist_application",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			}); txErr != nil {
				return txErr
			}

			// Notify candidate
			hubUser, _ := qtx.GetHubUserByGlobalID(ctx, app.ApplicantHubUserGlobalID)
			if hubUser.EmailAddress != "" {
				_, _ = qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
					EmailType:     regionaldb.EmailTemplateTypeHubApplicationShortlisted,
					EmailTo:       hubUser.EmailAddress,
					EmailSubject:  "Your application has been shortlisted",
					EmailTextBody: fmt.Sprintf("Congratulations! Your application has been shortlisted. You can view your candidacy at /my-candidacies/%s", candidacy.CandidacyID.String()),
					EmailHtmlBody: fmt.Sprintf("<p>Congratulations! Your application has been shortlisted.</p>"),
				})
			}
			return nil
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, server.ErrNotFound) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if errors.Is(err, server.ErrInvalidState) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			s.Logger(ctx).Error("failed to shortlist application", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Update global index so hub list-my-applications shows "shortlisted"
		if err := s.Global.UpdateApplicationIndexState(ctx, globaldb.UpdateApplicationIndexStateParams{
			ApplicationID: appID,
			State:         "shortlisted",
		}); err != nil {
			s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to update application index after shortlist", "error", err, "application_id", req.ApplicationID)
		}

		result := org.OrgCandidacy{
			CandidacyID:          candidacy.CandidacyID.String(),
			ApplicationID:        candidacy.ApplicationID.String(),
			OpeningID:            candidacy.OpeningID.String(),
			OpeningTitle:         "",
			CandidateHandle:      "",
			CandidateDisplayName: "",
			State:                org.CandidacyState(candidacy.State),
			CreatedAt:            candidacy.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
			StateChangedAt:       candidacy.StateChangedAt.Time.UTC().Format(time.RFC3339Nano),
			Interviews:           []org.OrgInterviewSummary{},
			Comments:             []org.CandidacyComment{},
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(result)
	}
}

func RejectApplication(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.RejectApplicationRequest
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

		var appID pgtype.UUID
		if err := appID.Scan(req.ApplicationID); err != nil {
			http.Error(w, "invalid application_id format", http.StatusBadRequest)
			return
		}

		eventData, _ := json.Marshal(map[string]interface{}{"application_id": req.ApplicationID})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			app, txErr := qtx.GetApplicationByID(ctx, appID)
			if txErr != nil {
				return txErr
			}
			if app.OrgID != orgUser.OrgID {
				return server.ErrNotFound
			}
			if app.State != "applied" {
				return server.ErrInvalidState
			}

			var rejectionReasonText pgtype.Text
			if req.RejectionReason != nil {
				rejectionReasonText.Scan(*req.RejectionReason)
			}
			if txErr := qtx.RejectApplication(ctx, regionaldb.RejectApplicationParams{
				ApplicationID:   appID,
				RejectionReason: rejectionReasonText,
			}); txErr != nil {
				return txErr
			}
			if txErr := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.reject_application",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			}); txErr != nil {
				return txErr
			}
			// Notify candidate
			hubUser, _ := qtx.GetHubUserByGlobalID(ctx, app.ApplicantHubUserGlobalID)
			if hubUser.EmailAddress != "" {
				_, _ = qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
					EmailType:     regionaldb.EmailTemplateTypeHubApplicationRejected,
					EmailTo:       hubUser.EmailAddress,
					EmailSubject:  "Application update",
					EmailTextBody: "Thank you for applying. Unfortunately your application was not selected to move forward.",
					EmailHtmlBody: "<p>Thank you for applying. Unfortunately your application was not selected to move forward.</p>",
				})
			}
			return nil
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, server.ErrNotFound) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if errors.Is(err, server.ErrInvalidState) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			s.Logger(ctx).Error("failed to reject application", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Update global index state so the hub list-my-applications shows "rejected"
		if err := s.Global.UpdateApplicationIndexState(ctx, globaldb.UpdateApplicationIndexStateParams{
			ApplicationID: appID,
			State:         "rejected",
		}); err != nil {
			s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to update application index after rejection", "error", err, "application_id", req.ApplicationID)
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

func LabelApplication(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.LabelApplicationRequest
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

		var appID pgtype.UUID
		if err := appID.Scan(req.ApplicationID); err != nil {
			http.Error(w, "invalid application_id format", http.StatusBadRequest)
			return
		}

		eventData, _ := json.Marshal(map[string]interface{}{"application_id": req.ApplicationID, "label": req.Label})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			app, txErr := qtx.GetApplicationByID(ctx, appID)
			if txErr != nil {
				return txErr
			}
			if app.OrgID != orgUser.OrgID {
				return server.ErrNotFound
			}
			if app.State != "applied" {
				return server.ErrInvalidState
			}

			var labelText pgtype.Text
			if req.Label != nil {
				labelText.Scan(string(*req.Label))
			}
			if txErr := qtx.LabelApplication(ctx, regionaldb.LabelApplicationParams{
				ApplicationID: appID,
				Label:         labelText,
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.label_application",
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
			s.Logger(ctx).Error("failed to label application", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}
