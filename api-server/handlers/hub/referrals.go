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

// ListReferralsReceived returns the candidate's inbox of agency referrals.
// A referral's source is now an agency Org (not a hub colleague). Multiple
// agencies may refer the same candidate to the same opening.
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

		var req hub.ListReferralsReceivedRequest
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

		// Keyset over the global index (fetch limit+1 to detect a next page).
		var indexEntries []globaldb.AgencyReferralsIndex
		var err error
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			cursorTs, cursorID := parseAppCursor(*req.PaginationKey)
			indexEntries, err = s.Global.ListReferralIndexByCandidateAfter(ctx, globaldb.ListReferralIndexByCandidateAfterParams{
				CandidateHubUserGlobalID: hubUser.HubUserGlobalID,
				CursorCreatedAt:          cursorTs,
				CursorReferralID:         cursorID,
				Limit:                    limit + 1,
			})
		} else {
			indexEntries, err = s.Global.ListReferralIndexByCandidate(ctx, globaldb.ListReferralIndexByCandidateParams{
				CandidateHubUserGlobalID: hubUser.HubUserGlobalID,
				Limit:                    limit + 1,
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

		// Bulk fetch referral details per region (no N+1).
		regionToIDs := map[globaldb.Region][]pgtype.UUID{}
		for _, idx := range indexEntries {
			region := globaldb.Region(idx.Region)
			regionToIDs[region] = append(regionToIDs[region], idx.ReferralID)
		}
		referralByID := map[pgtype.UUID]regionaldb.ListAgencyReferralsByIDsRow{}
		orgIDSet := map[pgtype.UUID]struct{}{}
		for region, ids := range regionToIDs {
			db := s.GetRegionalDB(region)
			if db == nil {
				continue
			}
			rows, rErr := db.ListAgencyReferralsByIDs(ctx, ids)
			if rErr != nil {
				log.Error("failed to list agency referrals by ids", "error", rErr, "region", region)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			for _, row := range rows {
				referralByID[row.ReferralID] = row
				orgIDSet[row.OrgID] = struct{}{}
				orgIDSet[row.AgencyOrgID] = struct{}{}
			}
		}

		// One bulk global lookup for consumer-org domain + agency-org name.
		orgIDs := make([]pgtype.UUID, 0, len(orgIDSet))
		for id := range orgIDSet {
			orgIDs = append(orgIDs, id)
		}
		type orgInfo struct{ name, domain string }
		orgByID := map[pgtype.UUID]orgInfo{}
		if len(orgIDs) > 0 {
			orgs, oErr := s.Global.GetOrgsByIDs(ctx, orgIDs)
			if oErr != nil {
				log.Error("failed to resolve org names", "error", oErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			for _, o := range orgs {
				orgByID[o.OrgID] = orgInfo{name: o.OrgName, domain: o.PrimaryDomain}
			}
		}

		referrals := make([]hub.ReferralReceived, 0, len(indexEntries))
		for _, idx := range indexEntries {
			row, ok := referralByID[idx.ReferralID]
			if !ok {
				continue
			}
			consumer := orgByID[row.OrgID]
			agency := orgByID[row.AgencyOrgID]
			var statement *string
			if row.StatementText.Valid {
				statement = &row.StatementText.String
			}
			referrals = append(referrals, hub.ReferralReceived{
				ReferralID:        row.ReferralID.String(),
				AgencyOrgDomain:   row.AgencyOrgDomain,
				AgencyOrgName:     agency.name,
				ConsumerOrgDomain: consumer.domain,
				OpeningNumber:     row.OpeningNumberReal,
				OpeningTitle:      row.OpeningTitle,
				StatementText:     statement,
				State:             hub.AgencyReferralState(row.State),
				CreatedAt:         row.CreatedAt.Time.Format(time.RFC3339),
				ExpiresAt:         row.ExpiresAt.Time.Format(time.RFC3339),
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(hub.ListReferralsReceivedResponse{
			Referrals:         referrals,
			NextPaginationKey: nextKey,
		})
	}
}

// PendingReferralsCount returns the number of agency referrals awaiting the
// candidate's action (state = 'pending'). Surfaced as an actionable badge on the
// hub dashboard's referrals tile. Single global DB round-trip (the index state is
// the source of truth for inbox actionability).
func PendingReferralsCount(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		count, err := s.Global.CountPendingReferralsForCandidate(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			log.Error("failed to count pending referrals", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(hub.PendingReferralsCountResponse{Count: int32(count)})
	}
}

// DeclineReferral silently declines a pending agency referral.
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

		var referralID pgtype.UUID
		if err := referralID.Scan(req.ReferralID); err != nil {
			http.Error(w, "invalid referral_id", http.StatusBadRequest)
			return
		}

		// Resolve the referral's region from the global index and verify ownership.
		idxEntry, err := s.Global.GetAgencyReferralIndexEntry(ctx, referralID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get referral index entry", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if idxEntry.CandidateHubUserGlobalID != hubUser.HubUserGlobalID {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		region := globaldb.Region(idxEntry.Region)
		if err := s.WithRegionalTxFor(ctx, region, func(qtx *regionaldb.Queries) error {
			if _, txErr := qtx.DeclineAgencyReferralIfPending(ctx, referralID); txErr != nil {
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{"referral_id": req.ReferralID})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.decline_referral",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Not pending (already resolved) → invalid state.
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to decline referral", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		if idxErr := s.Global.UpdateAgencyReferralIndexState(ctx, globaldb.UpdateAgencyReferralIndexStateParams{
			ReferralID: referralID,
			State:      "declined",
		}); idxErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to update referral index state", "error", idxErr)
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}
