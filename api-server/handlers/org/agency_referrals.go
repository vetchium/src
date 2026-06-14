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
	orgspec "vetchium-api-server.typespec/org"
)

// parseAgencyCursor decodes a "<rfc3339nano>|<uuid>" keyset cursor.
func parseAgencyCursor(key string) (pgtype.Timestamptz, pgtype.UUID) {
	var ts pgtype.Timestamptz
	var id pgtype.UUID
	parts := strings.SplitN(key, "|", 2)
	if len(parts) != 2 {
		return ts, id
	}
	if t, err := time.Parse(time.RFC3339Nano, parts[0]); err == nil {
		ts = pgtype.Timestamptz{Time: t, Valid: true}
	}
	_ = id.Scan(parts[1])
	return ts, id
}

func agencyLimit(req *int32) int32 {
	limit := int32(20)
	if req != nil && *req > 0 {
		limit = *req
	}
	if limit > 100 {
		limit = 100
	}
	return limit
}

func isUniqueViolation(err error) bool {
	var pgErr interface{ SQLState() string }
	return errors.As(err, &pgErr) && pgErr.SQLState() == "23505"
}

// AssignOpeningAgency assigns an actively-subscribed staffing provider as an
// official recruiting agency on one of the consumer org's published openings.
func AssignOpeningAgency(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.AssignOpeningAgencyRequest
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

		opening, err := s.RegionalForCtx(ctx).GetOpeningByID(ctx, regionaldb.GetOpeningByIDParams{
			OpeningID: openingID,
			OrgID:     orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get opening", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if opening.Status != "published" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		actx, err := s.Global.ResolveAgencyAssignmentContext(ctx, globaldb.ResolveAgencyAssignmentContextParams{
			ConsumerOrgID: orgUser.OrgID,
			AgencyDomain:  req.AgencyOrgDomain,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound) // agency domain unknown
				return
			}
			log.Error("failed to resolve agency context", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if actx.AgencyOrgID == orgUser.OrgID || !actx.HasActiveStaffingSub {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if _, txErr := qtx.CreateOpeningAgencyAssignment(ctx, regionaldb.CreateOpeningAgencyAssignmentParams{
				OpeningID:           openingID,
				OrgID:               orgUser.OrgID,
				AgencyOrgID:         actx.AgencyOrgID,
				AgencyOrgDomain:     req.AgencyOrgDomain,
				AssignedByOrgUserID: orgUser.OrgUserID,
			}); txErr != nil {
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{
				"opening_id":    req.OpeningID,
				"agency_org_id": actx.AgencyOrgID.String(),
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.assign_opening_agency",
				ActorUserID: orgUser.OrgUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			if isUniqueViolation(err) {
				w.WriteHeader(http.StatusConflict)
				return
			}
			log.Error("failed to assign agency", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		if idxErr := s.Global.InsertOpeningAgencyAssignmentIndex(ctx, globaldb.InsertOpeningAgencyAssignmentIndexParams{
			OpeningID:         openingID,
			AgencyOrgID:       actx.AgencyOrgID,
			AgencyOrgDomain:   req.AgencyOrgDomain,
			Region:            middleware.OrgRegionFromContext(ctx),
			ConsumerOrgID:     orgUser.OrgID,
			ConsumerOrgDomain: actx.ConsumerDomain,
			OpeningNumber:     opening.OpeningNumber,
			TitleSnapshot:     opening.Title,
			CreatedAt:         pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
		}); idxErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to insert assignment index", "error", idxErr)
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

// RemoveOpeningAgency removes an assigned agency from an opening.
func RemoveOpeningAgency(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.RemoveOpeningAgencyRequest
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

		var removed regionaldb.OpeningAgencyAssignment
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			row, txErr := qtx.DeleteOpeningAgencyAssignment(ctx, regionaldb.DeleteOpeningAgencyAssignmentParams{
				OpeningID:       openingID,
				OrgID:           orgUser.OrgID,
				AgencyOrgDomain: req.AgencyOrgDomain,
			})
			if txErr != nil {
				return txErr
			}
			removed = row
			eventData, _ := json.Marshal(map[string]any{
				"opening_id":    req.OpeningID,
				"agency_org_id": row.AgencyOrgID.String(),
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.remove_opening_agency",
				ActorUserID: orgUser.OrgUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to remove agency", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		if idxErr := s.Global.DeleteOpeningAgencyAssignmentIndex(ctx, globaldb.DeleteOpeningAgencyAssignmentIndexParams{
			OpeningID:   openingID,
			AgencyOrgID: removed.AgencyOrgID,
		}); idxErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to delete assignment index", "error", idxErr)
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

// ListOpeningAgencies lists the agencies assigned to one of the consumer's openings.
func ListOpeningAgencies(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.ListOpeningAgenciesRequest
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

		rows, err := s.RegionalForCtx(ctx).ListOpeningAgencies(ctx, regionaldb.ListOpeningAgenciesParams{
			OpeningID: openingID,
			OrgID:     orgUser.OrgID,
		})
		if err != nil {
			log.Error("failed to list opening agencies", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		agencyIDs := make([]pgtype.UUID, 0, len(rows))
		for _, row := range rows {
			agencyIDs = append(agencyIDs, row.AgencyOrgID)
		}
		nameByID := map[pgtype.UUID]string{}
		if len(agencyIDs) > 0 {
			orgs, oErr := s.Global.GetOrgsByIDs(ctx, agencyIDs)
			if oErr != nil {
				log.Error("failed to resolve agency names", "error", oErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			for _, o := range orgs {
				nameByID[o.OrgID] = o.OrgName
			}
		}

		agencies := make([]orgspec.OpeningAgency, 0, len(rows))
		for _, row := range rows {
			agencies = append(agencies, orgspec.OpeningAgency{
				AgencyOrgDomain: row.AgencyOrgDomain,
				AgencyOrgName:   nameByID[row.AgencyOrgID],
				AssignedAt:      row.CreatedAt.Time.Format(time.RFC3339),
				ReferralsMade:   int32(row.ReferralsMade),
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(orgspec.ListOpeningAgenciesResponse{Agencies: agencies})
	}
}

// ListAssignedOpenings lists openings the caller's agency is assigned to
// (agency side, served entirely from the global assignment index).
func ListAssignedOpenings(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.ListAssignedOpeningsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		limit := agencyLimit(req.Limit)
		var rows []globaldb.OpeningAgencyAssignmentIndex
		var err error
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			cursorTs, cursorID := parseAgencyCursor(*req.PaginationKey)
			rows, err = s.Global.ListAssignedOpeningsByAgencyAfter(ctx, globaldb.ListAssignedOpeningsByAgencyAfterParams{
				AgencyOrgID:     orgUser.OrgID,
				CursorCreatedAt: cursorTs,
				CursorOpeningID: cursorID,
				Limit:           limit + 1,
			})
		} else {
			rows, err = s.Global.ListAssignedOpeningsByAgency(ctx, globaldb.ListAssignedOpeningsByAgencyParams{
				AgencyOrgID: orgUser.OrgID,
				Limit:       limit + 1,
			})
		}
		if err != nil {
			log.Error("failed to list assigned openings", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			last := rows[len(rows)-1]
			k := fmt.Sprintf("%s|%s", last.CreatedAt.Time.UTC().Format(time.RFC3339Nano), last.OpeningID.String())
			nextKey = &k
		}

		openings := make([]orgspec.AssignedOpening, 0, len(rows))
		for _, row := range rows {
			openings = append(openings, orgspec.AssignedOpening{
				OpeningID:         row.OpeningID.String(),
				ConsumerOrgDomain: row.ConsumerOrgDomain,
				OpeningNumber:     row.OpeningNumber,
				Title:             row.TitleSnapshot,
				AssignedAt:        row.CreatedAt.Time.Format(time.RFC3339),
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(orgspec.ListAssignedOpeningsResponse{
			Openings:          openings,
			NextPaginationKey: nextKey,
		})
	}
}

// ReferCandidate refers a Hub user into an opening the caller's agency is
// assigned to. No colleague/stint/connection prerequisite.
func ReferCandidate(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.ReferCandidateRequest
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

		// One global read: assignment exists AND staffing subscription active.
		actx, err := s.Global.ValidateAgencyAssignmentActive(ctx, globaldb.ValidateAgencyAssignmentActiveParams{
			OpeningID:   openingID,
			AgencyOrgID: orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			log.Error("failed to validate assignment", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Resolve candidate handle -> global id.
		candidate, err := s.Global.GetHubUserByHandle(ctx, req.CandidateHandle)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to resolve candidate handle", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		openingRegion := globaldb.Region(actx.Region)
		openingDB := s.GetRegionalDB(openingRegion)
		if openingDB == nil {
			log.Error("unknown opening region", "region", actx.Region)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Opening must still be published.
		opening, err := openingDB.GetOpeningByID(ctx, regionaldb.GetOpeningByIDParams{
			OpeningID: openingID,
			OrgID:     actx.ConsumerOrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get opening", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if opening.Status != "published" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		var statement pgtype.Text
		if req.StatementText != nil && *req.StatementText != "" {
			statement = pgtype.Text{String: *req.StatementText, Valid: true}
		}

		var referral regionaldb.AgencyReferral
		if err := s.WithRegionalTxFor(ctx, openingRegion, func(qtx *regionaldb.Queries) error {
			var txErr error
			referral, txErr = qtx.CreateAgencyReferral(ctx, regionaldb.CreateAgencyReferralParams{
				OpeningID:                openingID,
				OrgID:                    actx.ConsumerOrgID,
				AgencyOrgID:              orgUser.OrgID,
				AgencyOrgDomain:          actx.AgencyOrgDomain,
				ReferredByOrgUserID:      orgUser.OrgUserID,
				CandidateHubUserGlobalID: candidate.HubUserGlobalID,
				CandidateHandleSnapshot:  req.CandidateHandle,
				StatementText:            statement,
			})
			if txErr != nil {
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{
				"referral_id": referral.ReferralID.String(),
				"opening_id":  req.OpeningID,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.refer_candidate",
				ActorUserID: orgUser.OrgUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			if isUniqueViolation(err) {
				w.WriteHeader(http.StatusConflict)
				return
			}
			log.Error("failed to create referral", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		if idxErr := s.Global.InsertAgencyReferralIndex(ctx, globaldb.InsertAgencyReferralIndexParams{
			ReferralID:               referral.ReferralID,
			CandidateHubUserGlobalID: candidate.HubUserGlobalID,
			AgencyOrgID:              orgUser.OrgID,
			Region:                   actx.Region,
			OpeningID:                openingID,
			State:                    "pending",
			CreatedAt:                referral.CreatedAt,
		}); idxErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to insert referral index", "error", idxErr)
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(orgspec.ReferCandidateResponse{ReferralID: referral.ReferralID.String()})
	}
}

// ListAgencyReferrals lists referrals the caller's agency has made.
func ListAgencyReferrals(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.ListAgencyReferralsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		limit := agencyLimit(req.Limit)
		var indexEntries []globaldb.AgencyReferralsIndex
		var err error
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			cursorTs, cursorID := parseAgencyCursor(*req.PaginationKey)
			indexEntries, err = s.Global.ListReferralIndexByAgencyAfter(ctx, globaldb.ListReferralIndexByAgencyAfterParams{
				AgencyOrgID:      orgUser.OrgID,
				CursorCreatedAt:  cursorTs,
				CursorReferralID: cursorID,
				Limit:            limit + 1,
			})
		} else {
			indexEntries, err = s.Global.ListReferralIndexByAgency(ctx, globaldb.ListReferralIndexByAgencyParams{
				AgencyOrgID: orgUser.OrgID,
				Limit:       limit + 1,
			})
		}
		if err != nil {
			log.Error("failed to list agency referral index", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(indexEntries)) > limit {
			indexEntries = indexEntries[:limit]
			last := indexEntries[len(indexEntries)-1]
			k := fmt.Sprintf("%s|%s", last.CreatedAt.Time.UTC().Format(time.RFC3339Nano), last.ReferralID.String())
			nextKey = &k
		}

		regionToIDs := map[globaldb.Region][]pgtype.UUID{}
		for _, idx := range indexEntries {
			region := globaldb.Region(idx.Region)
			regionToIDs[region] = append(regionToIDs[region], idx.ReferralID)
		}
		referralByID := map[pgtype.UUID]regionaldb.ListAgencyReferralsByIDsRow{}
		consumerIDSet := map[pgtype.UUID]struct{}{}
		for region, ids := range regionToIDs {
			db := s.GetRegionalDB(region)
			if db == nil {
				continue
			}
			rows, rErr := db.ListAgencyReferralsByIDs(ctx, ids)
			if rErr != nil {
				log.Error("failed to list referrals by ids", "error", rErr, "region", region)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			for _, row := range rows {
				referralByID[row.ReferralID] = row
				consumerIDSet[row.OrgID] = struct{}{}
			}
		}

		consumerIDs := make([]pgtype.UUID, 0, len(consumerIDSet))
		for id := range consumerIDSet {
			consumerIDs = append(consumerIDs, id)
		}
		domainByID := map[pgtype.UUID]string{}
		if len(consumerIDs) > 0 {
			orgs, oErr := s.Global.GetOrgsByIDs(ctx, consumerIDs)
			if oErr != nil {
				log.Error("failed to resolve consumer domains", "error", oErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			for _, o := range orgs {
				domainByID[o.OrgID] = o.PrimaryDomain
			}
		}

		referrals := make([]orgspec.AgencyReferral, 0, len(indexEntries))
		for _, idx := range indexEntries {
			row, ok := referralByID[idx.ReferralID]
			if !ok {
				continue
			}
			referrals = append(referrals, orgspec.AgencyReferral{
				ReferralID:        row.ReferralID.String(),
				CandidateHandle:   row.CandidateHandleSnapshot,
				ConsumerOrgDomain: domainByID[row.OrgID],
				OpeningNumber:     row.OpeningNumberReal,
				OpeningTitle:      row.OpeningTitle,
				State:             orgspec.AgencyReferralState(row.State),
				CreatedAt:         row.CreatedAt.Time.Format(time.RFC3339),
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(orgspec.ListAgencyReferralsResponse{
			Referrals:         referrals,
			NextPaginationKey: nextKey,
		})
	}
}
