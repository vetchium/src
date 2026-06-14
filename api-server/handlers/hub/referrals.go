package hub

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
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

// NominateColleagueForRole creates a referral nomination (referrer nominates a former colleague for an opening)
func NominateColleagueForRole(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.NominateColleagueRequest
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

		// Cannot nominate self
		if req.CandidateHandle == hubUser.Handle {
			http.Error(w, "cannot_nominate_self", http.StatusBadRequest)
			return
		}

		// Resolve org from domain
		org, err := s.Global.GetOrgByDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get org by domain", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		openingRegion := org.Region
		regionalDB := s.GetRegionalDB(openingRegion)
		if regionalDB == nil {
			log.Error("unknown region", "region", openingRegion)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Verify referrer has active stint at org's domain (in their home region)
		homeDB := s.RegionalForCtx(ctx)
		hasStint, err := homeDB.CheckReferrerHasActiveStintAtDomain(ctx, regionaldb.CheckReferrerHasActiveStintAtDomainParams{
			HubUserID: hubUser.HubUserGlobalID,
			Domain:    req.OrgDomain,
		})
		if err != nil {
			log.Error("failed to check active stint", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if !hasStint {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		// Verify candidate is a connection
		peers, err := homeDB.GetConnectedPeersByHandles(ctx, regionaldb.GetConnectedPeersByHandlesParams{
			Me:      hubUser.HubUserGlobalID,
			Handles: []string{req.CandidateHandle},
		})
		if err != nil {
			log.Error("failed to get connected peers", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if len(peers) == 0 {
			http.Error(w, "not_a_connection", http.StatusBadRequest)
			return
		}
		candidateID := peers[0].Peer

		// Verify opening exists and is published
		opening, err := regionalDB.GetOpeningByNumber(ctx, regionaldb.GetOpeningByNumberParams{
			OrgID:         org.OrgID,
			OpeningNumber: req.OpeningNumber,
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

		// Get shared work domain context
		sharedCtx, err := homeDB.GetSharedWorkDomain(ctx, regionaldb.GetSharedWorkDomainParams{
			HubUserID:   hubUser.HubUserGlobalID,
			HubUserID_2: candidateID,
		})
		if err != nil {
			log.Error("failed to get shared work domain", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var referral regionaldb.ReferralNomination
		if err := s.WithRegionalTxFor(ctx, openingRegion, func(qtx *regionaldb.Queries) error {
			var txErr error
			referral, txErr = qtx.CreateReferral(ctx, regionaldb.CreateReferralParams{
				ReferrerHubUserGlobalID:  hubUser.HubUserGlobalID,
				CandidateHubUserGlobalID: candidateID,
				OpeningID:                opening.OpeningID,
				OrgID:                    org.OrgID,
				StatementText:            req.StatementText,
				SharedDomain:             sharedCtx.SharedDomain,
				OverlapStartYear:         sharedCtx.OverlapStartYear,
				OverlapEndYear:           sharedCtx.OverlapEndYear,
			})
			if txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]interface{}{
				"nomination_id": referral.NominationID.String(),
				"opening_id":    opening.OpeningID.String(),
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.nominate_colleague",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			var pgErr interface{ SQLState() string }
			if errors.As(err, &pgErr) && pgErr.SQLState() == "23505" {
				w.WriteHeader(http.StatusConflict)
				return
			}
			log.Error("failed to create referral", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Write global index
		if idxErr := s.Global.InsertReferralNominationIndex(ctx, globaldb.InsertReferralNominationIndexParams{
			NominationID:             referral.NominationID,
			CandidateHubUserGlobalID: candidateID,
			ReferrerHubUserGlobalID:  hubUser.HubUserGlobalID,
			Region:                   string(openingRegion),
			OpeningID:                opening.OpeningID,
			State:                    "pending",
			CreatedAt:                referral.CreatedAt,
		}); idxErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to insert referral nomination index", "error", idxErr)
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(hub.NominateColleagueResponse{
			NominationID: referral.NominationID.String(),
		})
	}
}

// ListReferralsReceived lists referral nominations received by the hub user (candidate)
func ListReferralsReceived(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.ListReferralsRequest
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

		limit := int32(20)
		if req.Limit != nil && *req.Limit > 0 {
			limit = *req.Limit
		}
		if limit > 100 {
			limit = 100
		}

		// List from global index (keyset paginated). Fetch limit+1 to detect
		// whether a further page exists.
		var indexEntries []globaldb.ReferralNominationsIndex
		var err error
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			cursorTs, cursorID := parseAppCursor(*req.PaginationKey)
			indexEntries, err = s.Global.ListReferralNominationsIndexByCandidateAfter(ctx, globaldb.ListReferralNominationsIndexByCandidateAfterParams{
				CandidateHubUserGlobalID: hubUser.HubUserGlobalID,
				CursorCreatedAt:          cursorTs,
				CursorNominationID:       cursorID,
				Limit:                    limit + 1,
			})
		} else {
			indexEntries, err = s.Global.ListReferralNominationsIndexByCandidate(ctx, globaldb.ListReferralNominationsIndexByCandidateParams{
				CandidateHubUserGlobalID: hubUser.HubUserGlobalID,
				Limit:                    limit + 1,
			})
		}
		if err != nil {
			log.Error("failed to list referral nominations index", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(indexEntries)) > limit {
			indexEntries = indexEntries[:limit]
			last := indexEntries[len(indexEntries)-1]
			k := fmt.Sprintf("%s|%s", last.CreatedAt.Time.UTC().Format(time.RFC3339Nano), last.NominationID.String())
			nextKey = &k
		}

		// Fetch full referral details from regional DBs grouped by region
		regionToIDs := map[globaldb.Region][]pgtype.UUID{}
		for _, idx := range indexEntries {
			region := globaldb.Region(idx.Region)
			regionToIDs[region] = append(regionToIDs[region], idx.NominationID)
		}

		referralByID := map[pgtype.UUID]regionaldb.ReferralNomination{}
		for region, ids := range regionToIDs {
			db := s.GetRegionalDB(region)
			if db == nil {
				continue
			}
			rows, err := db.ListReferralsByIDs(ctx, ids)
			if err != nil {
				log.Error("failed to list referrals by IDs", "error", err, "region", region)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			for _, row := range rows {
				referralByID[row.NominationID] = row
			}
		}

		referrals := make([]hub.ReferralReceived, 0, len(indexEntries))
		for _, idx := range indexEntries {
			row, ok := referralByID[idx.NominationID]
			if !ok {
				continue
			}
			referrals = append(referrals, hub.ReferralReceived{
				NominationID:     row.NominationID.String(),
				OrgDomain:        "",
				OrgName:          "",
				OpeningNumber:    0,
				OpeningTitle:     "",
				StatementText:    row.StatementText,
				SharedDomain:     row.SharedDomain,
				OverlapStartYear: row.OverlapStartYear,
				OverlapEndYear:   row.OverlapEndYear,
				State:            hub.ReferralState(row.State),
				CreatedAt:        row.CreatedAt.Time.Format("2006-01-02T15:04:05Z"),
				ExpiresAt:        row.ExpiresAt.Time.Format("2006-01-02T15:04:05Z"),
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(hub.ListReferralsReceivedResponse{
			Referrals:         referrals,
			NextPaginationKey: nextKey,
		})
	}
}

// ListReferralsMade lists referrals made by the hub user (referrer's history)
func ListReferralsMade(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.ListReferralsRequest
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

		limit := int32(20)
		if req.Limit != nil && *req.Limit > 0 {
			limit = *req.Limit
		}
		if limit > 100 {
			limit = 100
		}

		// List from global index (keyset paginated). Fetch limit+1 to detect
		// whether a further page exists.
		var indexEntries []globaldb.ReferralNominationsIndex
		var err error
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			cursorTs, cursorID := parseAppCursor(*req.PaginationKey)
			indexEntries, err = s.Global.ListReferralNominationsIndexByReferrerAfter(ctx, globaldb.ListReferralNominationsIndexByReferrerAfterParams{
				ReferrerHubUserGlobalID: hubUser.HubUserGlobalID,
				CursorCreatedAt:         cursorTs,
				CursorNominationID:      cursorID,
				Limit:                   limit + 1,
			})
		} else {
			indexEntries, err = s.Global.ListReferralNominationsIndexByReferrer(ctx, globaldb.ListReferralNominationsIndexByReferrerParams{
				ReferrerHubUserGlobalID: hubUser.HubUserGlobalID,
				Limit:                   limit + 1,
			})
		}
		if err != nil {
			log.Error("failed to list referral nominations index by referrer", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(indexEntries)) > limit {
			indexEntries = indexEntries[:limit]
			last := indexEntries[len(indexEntries)-1]
			k := fmt.Sprintf("%s|%s", last.CreatedAt.Time.UTC().Format(time.RFC3339Nano), last.NominationID.String())
			nextKey = &k
		}

		regionToIDs := map[globaldb.Region][]pgtype.UUID{}
		for _, idx := range indexEntries {
			region := globaldb.Region(idx.Region)
			regionToIDs[region] = append(regionToIDs[region], idx.NominationID)
		}

		referralByID := map[pgtype.UUID]regionaldb.ReferralNomination{}
		for region, ids := range regionToIDs {
			db := s.GetRegionalDB(region)
			if db == nil {
				continue
			}
			rows, err := db.ListReferralsByIDs(ctx, ids)
			if err != nil {
				log.Error("failed to list referrals by IDs", "error", err, "region", region)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			for _, row := range rows {
				referralByID[row.NominationID] = row
			}
		}

		referrals := make([]hub.ReferralMade, 0, len(indexEntries))
		for _, idx := range indexEntries {
			row, ok := referralByID[idx.NominationID]
			if !ok {
				continue
			}
			referrals = append(referrals, hub.ReferralMade{
				NominationID:         row.NominationID.String(),
				CandidateHandle:      "",
				CandidateDisplayName: "",
				OrgDomain:            "",
				OpeningNumber:        0,
				OpeningTitle:         "",
				State:                hub.ReferralState(row.State),
				CandidateDidApply:    row.State == "accepted_applied",
				CreatedAt:            row.CreatedAt.Time.Format("2006-01-02T15:04:05Z"),
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(hub.ListReferralsMadeResponse{
			Referrals:         referrals,
			NextPaginationKey: nextKey,
		})
	}
}

// AcceptReferral accepts a pending referral (returns prefill data for apply form)
func AcceptReferral(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.AcceptReferralRequest
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

		var nominationIDUUID pgtype.UUID
		if err := nominationIDUUID.Scan(req.NominationID); err != nil {
			http.Error(w, "invalid nomination_id", http.StatusBadRequest)
			return
		}

		// Resolve region from global index
		idxEntry, err := s.Global.GetReferralNominationIndexEntry(ctx, nominationIDUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get referral nomination index", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if idxEntry.CandidateHubUserGlobalID != hubUser.HubUserGlobalID {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		openingRegion := globaldb.Region(idxEntry.Region)
		regionalDB := s.GetRegionalDB(openingRegion)
		if regionalDB == nil {
			log.Error("unknown region", "region", openingRegion)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		referral, err := regionalDB.GetReferralByID(ctx, nominationIDUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get referral", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		if referral.State != "pending" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Acceptance is read-only — return prefill data; the actual application is a separate call
		// Get opening info for response
		opening, err := regionalDB.GetOpeningByID(ctx, regionaldb.GetOpeningByIDParams{
			OpeningID: referral.OpeningID,
			OrgID:     referral.OrgID,
		})
		if err != nil {
			log.Error("failed to get opening", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Resolve the org's domain for the apply-form prefill. Prefer the
		// primary domain; fall back to any verified domain if none is primary.
		orgDomain, err := s.Global.GetPrimaryDomainByOrg(ctx, referral.OrgID)
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				log.Error("failed to get org primary domain", "error", err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			domains, dErr := s.Global.GetGlobalOrgDomainsByOrg(ctx, referral.OrgID)
			if dErr != nil || len(domains) == 0 {
				log.Error("failed to resolve org domain", "error", dErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			orgDomain = domains[0].Domain
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(hub.AcceptReferralResponse{
			OrgDomain:                      orgDomain,
			OpeningNumber:                  opening.OpeningNumber,
			PrefillStatementForEndorsement: referral.StatementText,
		})
	}
}

// DeclineReferral declines a pending referral silently
func DeclineReferral(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.DeclineReferralRequest
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

		var nominationIDUUID pgtype.UUID
		if err := nominationIDUUID.Scan(req.NominationID); err != nil {
			http.Error(w, "invalid nomination_id", http.StatusBadRequest)
			return
		}

		idxEntry, err := s.Global.GetReferralNominationIndexEntry(ctx, nominationIDUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get referral nomination index", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if idxEntry.CandidateHubUserGlobalID != hubUser.HubUserGlobalID {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		openingRegion := globaldb.Region(idxEntry.Region)

		if err := s.WithRegionalTxFor(ctx, openingRegion, func(qtx *regionaldb.Queries) error {
			referral, txErr := qtx.GetReferralByID(ctx, nominationIDUUID)
			if txErr != nil {
				return txErr
			}
			if referral.State != "pending" {
				return errWindowClosed
			}
			if _, txErr = qtx.ResolveReferralDeclined(ctx, nominationIDUUID); txErr != nil {
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{
				"nomination_id": req.NominationID,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.decline_referral",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			if errors.Is(err, errWindowClosed) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to decline referral", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Update global index
		if idxErr := s.Global.UpdateReferralNominationIndexState(ctx, globaldb.UpdateReferralNominationIndexStateParams{
			NominationID: nominationIDUUID,
			State:        "declined",
		}); idxErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to update referral nomination index state", "error", idxErr)
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}
