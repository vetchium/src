package org

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

// isAgencyLead reports whether the org user bypasses assignee scoping — either
// org:superadmin or org:manage_agency_recruiters.
func isAgencyLead(ctx context.Context, db *regionaldb.Queries, orgUserID pgtype.UUID) bool {
	for _, name := range []string{"org:superadmin", "org:manage_agency_recruiters"} {
		role, err := db.GetRoleByName(ctx, name)
		if err != nil {
			continue
		}
		has, err := db.HasOrgUserRole(ctx, regionaldb.HasOrgUserRoleParams{
			OrgUserID: orgUserID,
			RoleID:    role.RoleID,
		})
		if err == nil && has {
			return true
		}
	}
	return false
}

// isOpeningAssignee reports whether userID is the single assignee of the opening.
func isOpeningAssignee(
	ctx context.Context,
	db *regionaldb.Queries,
	agencyOrgID, userID, openingID pgtype.UUID,
) (bool, error) {
	row, err := db.GetOpeningAssignee(ctx, regionaldb.GetOpeningAssigneeParams{
		AgencyOrgID: agencyOrgID,
		OpeningID:   openingID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return row.AgencyOrgUserID.Valid && row.AgencyOrgUserID == userID, nil
}

// assigneeRef builds the response assignee ref + needs_reassignment flag from a
// (nullable) assignee id, name, email and active flag.
func assigneeRef(
	userID pgtype.UUID, name, email string, active pgtype.Bool,
) (*orgspec.AgencyRecruiterRef, bool) {
	if !userID.Valid {
		return nil, true // no assignee at all → needs reassignment
	}
	ref := &orgspec.AgencyRecruiterRef{
		OrgUserID: userID.String(),
		Name:      name,
		Email:     email,
	}
	return ref, !active.Bool
}

// uuidSlice returns a non-nil slice so it marshals to a real empty SQL array
// (`'{}'`) rather than NULL — important for `= ANY(...)` predicates.
func uuidSlice(s []pgtype.UUID) []pgtype.UUID {
	if s == nil {
		return []pgtype.UUID{}
	}
	return s
}

func textPtr(t pgtype.Text) *string {
	if !t.Valid || t.String == "" {
		return nil
	}
	v := t.String
	return &v
}

// ListAgencyRecruiters returns the agency's active org-users for assignee selects.
// Disabled/invited users are never returned.
func ListAgencyRecruiters(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		rows, err := s.RegionalForCtx(ctx).ListActiveOrgUsersByOrg(ctx, orgUser.OrgID)
		if err != nil {
			log.Error("failed to list agency recruiters", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		recruiters := make([]orgspec.AgencyRecruiterRef, 0, len(rows))
		for _, row := range rows {
			recruiters = append(recruiters, orgspec.AgencyRecruiterRef{
				OrgUserID: row.OrgUserID.String(),
				Name:      row.FullName,
				Email:     row.EmailAddress,
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(orgspec.ListAgencyRecruitersResponse{Recruiters: recruiters})
	}
}

// ReassignOpening changes an opening's single assignee to another active agency
// user. Lead-only. 404 if the opening is not assigned to this agency; 422 if the
// target user is not an active member of this agency.
func ReassignOpening(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.ReassignOpeningRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var openingID, userID pgtype.UUID
		if err := openingID.Scan(req.OpeningID); err != nil {
			http.Error(w, "invalid opening_id", http.StatusBadRequest)
			return
		}
		if err := userID.Scan(req.AgencyOrgUserID); err != nil {
			http.Error(w, "invalid agency_org_user_id", http.StatusBadRequest)
			return
		}

		db := s.RegionalForCtx(ctx)
		// Target must be an active member of this agency.
		target, err := db.GetActiveOrgUserByID(ctx, regionaldb.GetActiveOrgUserByIDParams{
			OrgUserID: userID,
			OrgID:     orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to resolve reassign target", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var affected int64
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			n, txErr := qtx.SetOpeningAssignee(ctx, regionaldb.SetOpeningAssigneeParams{
				AgencyOrgID:         orgUser.OrgID,
				OpeningID:           openingID,
				AgencyOrgUserID:     userID,
				AssignedByOrgUserID: orgUser.OrgUserID,
			})
			if txErr != nil {
				return txErr
			}
			affected = n
			if n == 0 {
				return nil
			}
			eventData, _ := json.Marshal(map[string]any{
				"opening_id":         req.OpeningID,
				"agency_org_user_id": req.AgencyOrgUserID,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.reassign_opening",
				ActorUserID: orgUser.OrgUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			log.Error("failed to reassign opening", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if affected == 0 {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Best-effort: notify the new assignee. Opening metadata lives in the
		// global index (one read); a failure here does not undo the reassignment.
		if meta, mErr := s.Global.GetAssignedOpeningForAgency(ctx, globaldb.GetAssignedOpeningForAgencyParams{
			AgencyOrgID: orgUser.OrgID,
			OpeningID:   openingID,
		}); mErr == nil && target.EmailAddress != "" {
			subject, text, html := recruiterAssignedEmail(
				s.UIConfig.OrgURL, meta.ConsumerOrgDomain, meta.TitleSnapshot,
				meta.OpeningNumber, req.OpeningID)
			_, _ = db.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
				EmailType:     regionaldb.EmailTemplateTypeOrgRecruiterAssigned,
				EmailTo:       target.EmailAddress,
				EmailSubject:  subject,
				EmailTextBody: text,
				EmailHtmlBody: html,
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

// ListClientDefaultAssignees lists the agency's single default assignee per client
// domain.
func ListClientDefaultAssignees(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		rows, err := s.RegionalForCtx(ctx).ListClientDefaultAssigneesByAgency(ctx, orgUser.OrgID)
		if err != nil {
			log.Error("failed to list client default assignees", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		defaults := make([]orgspec.ClientDefaultAssignee, 0, len(rows))
		for _, row := range rows {
			defaults = append(defaults, orgspec.ClientDefaultAssignee{
				ConsumerOrgDomain: row.ConsumerOrgDomain,
				Assignee: orgspec.AgencyRecruiterRef{
					OrgUserID: row.AgencyOrgUserID.String(),
					Name:      row.FullName,
					Email:     row.EmailAddress,
				},
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(orgspec.ListClientDefaultAssigneesResponse{Defaults: defaults})
	}
}

// SetClientDefaultAssignee sets (or replaces) the single default assignee for a
// client domain. Lead-only. 422 if the target user is not an active agency member.
func SetClientDefaultAssignee(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.SetClientDefaultAssigneeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var userID pgtype.UUID
		if err := userID.Scan(req.AgencyOrgUserID); err != nil {
			http.Error(w, "invalid agency_org_user_id", http.StatusBadRequest)
			return
		}

		db := s.RegionalForCtx(ctx)
		if _, err := db.GetActiveOrgUserByID(ctx, regionaldb.GetActiveOrgUserByIDParams{
			OrgUserID: userID,
			OrgID:     orgUser.OrgID,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to resolve default assignee target", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.UpsertClientDefaultAssignee(ctx, regionaldb.UpsertClientDefaultAssigneeParams{
				AgencyOrgID:        orgUser.OrgID,
				ConsumerOrgDomain:  req.ConsumerOrgDomain,
				AgencyOrgUserID:    userID,
				UpdatedByOrgUserID: orgUser.OrgUserID,
			}); txErr != nil {
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{
				"consumer_org_domain": req.ConsumerOrgDomain,
				"agency_org_user_id":  req.AgencyOrgUserID,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.set_client_default_assignee",
				ActorUserID: orgUser.OrgUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			log.Error("failed to set client default assignee", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

// ClearClientDefaultAssignee removes the default assignee for a client domain.
// Lead-only. 404 if no default was configured.
func ClearClientDefaultAssignee(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.ClearClientDefaultAssigneeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var affected int64
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			n, txErr := qtx.ClearClientDefaultAssignee(ctx, regionaldb.ClearClientDefaultAssigneeParams{
				AgencyOrgID:       orgUser.OrgID,
				ConsumerOrgDomain: req.ConsumerOrgDomain,
			})
			if txErr != nil {
				return txErr
			}
			affected = n
			if n == 0 {
				return nil
			}
			eventData, _ := json.Marshal(map[string]any{
				"consumer_org_domain": req.ConsumerOrgDomain,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.clear_client_default_assignee",
				ActorUserID: orgUser.OrgUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			log.Error("failed to clear client default assignee", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if affected == 0 {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

// GetAgencyReferralSummary returns how many of the agency's openings need
// (re)assignment — used by the dashboard warning banner.
func GetAgencyReferralSummary(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		count, err := s.RegionalForCtx(ctx).CountNeedsReassignmentForAgency(ctx, orgUser.OrgID)
		if err != nil {
			log.Error("failed to count needs-reassignment openings", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(orgspec.AgencyReferralSummaryResponse{
			NeedsReassignmentCount: int32(count),
		})
	}
}
