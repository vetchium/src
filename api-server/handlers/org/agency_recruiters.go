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

// isAgencyLead reports whether the org user bypasses recruiter scoping — either
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

// isEffectiveRecruiter reports whether userID is an effective recruiter of the
// opening: an explicit assignee if any exist, otherwise a default for the
// opening's client domain. consumerDomain is the opening's client domain.
func isEffectiveRecruiter(
	ctx context.Context,
	db *regionaldb.Queries,
	agencyOrgID, userID, openingID pgtype.UUID,
	consumerDomain string,
) (bool, error) {
	explicit, err := db.ListOpeningRecruitersByOpeningIDs(ctx, regionaldb.ListOpeningRecruitersByOpeningIDsParams{
		AgencyOrgID: agencyOrgID,
		OpeningIds:  []pgtype.UUID{openingID},
	})
	if err != nil {
		return false, err
	}
	if len(explicit) > 0 {
		for _, e := range explicit {
			if e.AgencyOrgUserID == userID {
				return true, nil
			}
		}
		return false, nil
	}
	// No explicit assignment: fall back to the client-domain default.
	domains, err := db.ListDefaultDomainsForRecruiter(ctx, regionaldb.ListDefaultDomainsForRecruiterParams{
		AgencyOrgID:     agencyOrgID,
		AgencyOrgUserID: userID,
	})
	if err != nil {
		return false, err
	}
	for _, d := range domains {
		if d == consumerDomain {
			return true, nil
		}
	}
	return false, nil
}

// uuidSlice / strSlice return non-nil slices so they marshal to a real empty SQL
// array (`'{}'`) rather than NULL — important for the `NOT (x = ANY(...))` scoping
// predicate, where NULL would wrongly exclude rows.
func uuidSlice(s []pgtype.UUID) []pgtype.UUID {
	if s == nil {
		return []pgtype.UUID{}
	}
	return s
}

func strSlice(s []string) []string {
	if s == nil {
		return []string{}
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

// loadRecruiterMaps loads, for a set of openings, the explicit recruiter
// assignments (by opening) and the agency's client-domain defaults (by domain).
func loadRecruiterMaps(
	ctx context.Context,
	db *regionaldb.Queries,
	agencyOrgID pgtype.UUID,
	openingIDs []pgtype.UUID,
) (map[pgtype.UUID][]orgspec.AgencyRecruiterRef, map[string][]orgspec.AgencyRecruiterRef, error) {
	explicitByOpening := map[pgtype.UUID][]orgspec.AgencyRecruiterRef{}
	if len(openingIDs) > 0 {
		exRows, err := db.ListOpeningRecruitersByOpeningIDs(ctx, regionaldb.ListOpeningRecruitersByOpeningIDsParams{
			AgencyOrgID: agencyOrgID,
			OpeningIds:  openingIDs,
		})
		if err != nil {
			return nil, nil, err
		}
		for _, row := range exRows {
			explicitByOpening[row.OpeningID] = append(explicitByOpening[row.OpeningID], orgspec.AgencyRecruiterRef{
				OrgUserID: row.AgencyOrgUserID.String(),
				Name:      row.FullName,
				Email:     row.EmailAddress,
			})
		}
	}

	defaultsByDomain := map[string][]orgspec.AgencyRecruiterRef{}
	dfRows, err := db.ListClientDefaultRecruitersByAgency(ctx, agencyOrgID)
	if err != nil {
		return nil, nil, err
	}
	for _, row := range dfRows {
		defaultsByDomain[row.ConsumerOrgDomain] = append(defaultsByDomain[row.ConsumerOrgDomain], orgspec.AgencyRecruiterRef{
			OrgUserID: row.AgencyOrgUserID.String(),
			Name:      row.FullName,
			Email:     row.EmailAddress,
		})
	}
	return explicitByOpening, defaultsByDomain, nil
}

// effectiveRecruiters returns the effective recruiters of an opening and whether
// they came from the client-domain default (explicit assignees win over defaults).
func effectiveRecruiters(
	openingID pgtype.UUID,
	consumerDomain string,
	explicitByOpening map[pgtype.UUID][]orgspec.AgencyRecruiterRef,
	defaultsByDomain map[string][]orgspec.AgencyRecruiterRef,
) ([]orgspec.AgencyRecruiterRef, bool) {
	if ex := explicitByOpening[openingID]; len(ex) > 0 {
		return ex, false
	}
	if df := defaultsByDomain[consumerDomain]; len(df) > 0 {
		return df, true
	}
	return []orgspec.AgencyRecruiterRef{}, false
}

// ListAgencyRecruiters returns the agency's active org-users for recruiter selects.
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

// AssignOpeningRecruiters assigns one or more agency org-users to an opening
// (additive). Lead-only.
func AssignOpeningRecruiters(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.AssignOpeningRecruitersRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var openingID pgtype.UUID
		if err := openingID.Scan(req.OpeningID); err != nil {
			http.Error(w, "invalid opening_id", http.StatusBadRequest)
			return
		}

		// The opening must actually be assigned to this agency.
		if _, err := s.Global.GetAssignedOpeningForAgency(ctx, globaldb.GetAssignedOpeningForAgencyParams{
			AgencyOrgID: orgUser.OrgID,
			OpeningID:   openingID,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to verify assignment", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		userIDs := make([]pgtype.UUID, 0, len(req.AgencyOrgUserIDs))
		for _, id := range req.AgencyOrgUserIDs {
			var uid pgtype.UUID
			if err := uid.Scan(id); err != nil {
				http.Error(w, "invalid agency_org_user_id", http.StatusBadRequest)
				return
			}
			userIDs = append(userIDs, uid)
		}

		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			for _, uid := range userIDs {
				if txErr := qtx.AddOpeningRecruiter(ctx, regionaldb.AddOpeningRecruiterParams{
					AgencyOrgID:         orgUser.OrgID,
					OpeningID:           openingID,
					ConsumerOrgDomain:   req.ConsumerOrgDomain,
					AgencyOrgUserID:     uid,
					AssignedByOrgUserID: orgUser.OrgUserID,
				}); txErr != nil {
					return txErr
				}
			}
			eventData, _ := json.Marshal(map[string]any{
				"opening_id":          req.OpeningID,
				"agency_org_user_ids": req.AgencyOrgUserIDs,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.assign_opening_recruiters",
				ActorUserID: orgUser.OrgUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			log.Error("failed to assign recruiters", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

// RemoveOpeningRecruiter removes one agency org-user from an opening. Lead-only.
func RemoveOpeningRecruiter(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.RemoveOpeningRecruiterRequest
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

		var affected int64
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			n, txErr := qtx.RemoveOpeningRecruiter(ctx, regionaldb.RemoveOpeningRecruiterParams{
				AgencyOrgID:     orgUser.OrgID,
				OpeningID:       openingID,
				AgencyOrgUserID: userID,
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
				EventType:   "org.remove_opening_recruiter",
				ActorUserID: orgUser.OrgUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			log.Error("failed to remove recruiter", "error", err)
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

// ListClientDefaultRecruiters lists the agency's per-client default recruiters.
func ListClientDefaultRecruiters(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		rows, err := s.RegionalForCtx(ctx).ListClientDefaultRecruitersByAgency(ctx, orgUser.OrgID)
		if err != nil {
			log.Error("failed to list client defaults", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Group recruiters by client domain, preserving order of first appearance.
		order := make([]string, 0)
		byDomain := map[string][]orgspec.AgencyRecruiterRef{}
		for _, row := range rows {
			if _, seen := byDomain[row.ConsumerOrgDomain]; !seen {
				order = append(order, row.ConsumerOrgDomain)
			}
			byDomain[row.ConsumerOrgDomain] = append(byDomain[row.ConsumerOrgDomain], orgspec.AgencyRecruiterRef{
				OrgUserID: row.AgencyOrgUserID.String(),
				Name:      row.FullName,
				Email:     row.EmailAddress,
			})
		}

		defaults := make([]orgspec.ClientDefaultRecruiter, 0, len(order))
		for _, d := range order {
			defaults = append(defaults, orgspec.ClientDefaultRecruiter{
				ConsumerOrgDomain: d,
				Recruiters:        byDomain[d],
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(orgspec.ListClientDefaultRecruitersResponse{Defaults: defaults})
	}
}

// SetClientDefaultRecruiters replaces the default recruiters for a client domain.
// Lead-only.
func SetClientDefaultRecruiters(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.SetClientDefaultRecruitersRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		userIDs := make([]pgtype.UUID, 0, len(req.AgencyOrgUserIDs))
		for _, id := range req.AgencyOrgUserIDs {
			var uid pgtype.UUID
			if err := uid.Scan(id); err != nil {
				http.Error(w, "invalid agency_org_user_id", http.StatusBadRequest)
				return
			}
			userIDs = append(userIDs, uid)
		}

		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.DeleteClientDefaultRecruitersForDomain(ctx, regionaldb.DeleteClientDefaultRecruitersForDomainParams{
				AgencyOrgID:       orgUser.OrgID,
				ConsumerOrgDomain: req.ConsumerOrgDomain,
			}); txErr != nil {
				return txErr
			}
			for _, uid := range userIDs {
				if txErr := qtx.AddClientDefaultRecruiter(ctx, regionaldb.AddClientDefaultRecruiterParams{
					AgencyOrgID:        orgUser.OrgID,
					ConsumerOrgDomain:  req.ConsumerOrgDomain,
					AgencyOrgUserID:    uid,
					UpdatedByOrgUserID: orgUser.OrgUserID,
				}); txErr != nil {
					return txErr
				}
			}
			eventData, _ := json.Marshal(map[string]any{
				"consumer_org_domain": req.ConsumerOrgDomain,
				"agency_org_user_ids": req.AgencyOrgUserIDs,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.set_client_default_recruiters",
				ActorUserID: orgUser.OrgUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			log.Error("failed to set client defaults", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

// RemoveClientDefaultRecruiter removes one recruiter from a client domain default.
// Lead-only.
func RemoveClientDefaultRecruiter(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.RemoveClientDefaultRecruiterRequest
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

		var affected int64
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			n, txErr := qtx.RemoveClientDefaultRecruiter(ctx, regionaldb.RemoveClientDefaultRecruiterParams{
				AgencyOrgID:       orgUser.OrgID,
				ConsumerOrgDomain: req.ConsumerOrgDomain,
				AgencyOrgUserID:   userID,
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
				"agency_org_user_id":  req.AgencyOrgUserID,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.remove_client_default_recruiter",
				ActorUserID: orgUser.OrgUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			log.Error("failed to remove client default", "error", err)
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
