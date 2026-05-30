package hub

import (
	"context"
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

func ListReferenceRequestsIncoming(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		user := middleware.HubUserFromContext(ctx)
		if user == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.ListReferenceRequestsIncomingRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// The hub user's reference nominations live in the candidates' opening
		// regions. Resolve those regions from the global index, then fan out.
		regions, err := referenceNomineeRegions(ctx, s, user.HubUserGlobalID)
		if err != nil {
			s.Logger(ctx).Error("failed to resolve nominee regions", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var nominations []regionaldb.ReferenceNomination
		for _, region := range regions {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			rows, qErr := rdb.ListReferenceNominationsByNominee(ctx,
				regionaldb.ListReferenceNominationsByNomineeParams{
					NomineeHubUserGlobalID: user.HubUserGlobalID,
					Limit:                  int32(40),
				})
			if qErr != nil {
				s.Logger(ctx).Error("failed to list nominations", "region", region, "error", qErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			nominations = append(nominations, rows...)
		}

		requests := make([]hub.HubReferenceRequestSummary, 0, len(nominations))
		for _, n := range nominations {
			var nominationID *string
			nomID := n.NominationID.String()
			nominationID = &nomID
			state := hub.ReferenceNominationState(n.State)
			requests = append(requests, hub.HubReferenceRequestSummary{
				Kind:         hub.ReferenceInboxRequestKind("to_respond"),
				RequestID:    n.RequestID.String(),
				NominationID: nominationID,
				State:        &state,
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(hub.ListReferenceRequestsIncomingResponse{
			Requests: requests,
		})
	}
}

func NominateReferences(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		user := middleware.HubUserFromContext(ctx)
		if user == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.NominateReferencesRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var reqID pgtype.UUID
		if err := reqID.Scan(req.RequestID); err != nil {
			http.Error(w, "invalid request_id", http.StatusBadRequest)
			return
		}

		// The reference request lives on the candidate's candidacy, in the
		// opening's region. Probe the candidate's hiring regions to find it.
		regions, err := hubUserHiringRegions(ctx, s, user.HubUserGlobalID)
		if err != nil {
			log.Error("failed to resolve hiring regions", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var requestRegion globaldb.Region
		var openingDB *regionaldb.Queries
		var rr regionaldb.ReferenceRequest
		for _, region := range regions {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			got, qErr := rdb.GetReferenceRequest(ctx, reqID)
			if qErr == nil {
				requestRegion = region
				openingDB = rdb
				rr = got
				break
			}
			if !errors.Is(qErr, pgx.ErrNoRows) {
				log.Error("failed to get reference request", "region", region, "error", qErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
		}
		if openingDB == nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		candidacy, err := openingDB.GetCandidacy(ctx, rr.CandidacyID)
		if err != nil {
			log.Error("failed to get candidacy", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if candidacy.ApplicantHubUserGlobalID != user.HubUserGlobalID {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		// Resolve nominee handles → ids via the candidate's connections (which
		// live in their HOME region), before touching the opening's region.
		homeDB := s.RegionalForCtx(ctx)
		nomineeIDs := make([]pgtype.UUID, 0, len(req.NomineeHandles))
		for _, handle := range req.NomineeHandles {
			peers, pErr := homeDB.GetConnectedPeersByHandles(ctx, regionaldb.GetConnectedPeersByHandlesParams{
				Me:      user.HubUserGlobalID,
				Handles: []string{handle},
			})
			if pErr != nil {
				log.Error("failed to look up connection", "error", pErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			if len(peers) == 0 {
				http.Error(w, "nominee "+handle+" is not a connection", http.StatusBadRequest)
				return
			}
			nomineeIDs = append(nomineeIDs, peers[0].Peer)
		}

		// Create all nominations + audit log in one tx in the opening's region.
		eventData, _ := json.Marshal(map[string]any{"request_id": req.RequestID})
		type createdNomination struct {
			nominationID pgtype.UUID
			nomineeID    pgtype.UUID
		}
		var created []createdNomination
		if err := s.WithRegionalTxFor(ctx, requestRegion, func(qtx *regionaldb.Queries) error {
			created = nil
			for _, nomineeID := range nomineeIDs {
				nomination, txErr := qtx.CreateReferenceNomination(ctx, regionaldb.CreateReferenceNominationParams{
					RequestID:              reqID,
					NomineeHubUserGlobalID: nomineeID,
					SharedDomain:           "",
					OverlapStartYear:       0,
					OverlapEndYear:         0,
				})
				if txErr != nil {
					return txErr
				}
				created = append(created, createdNomination{nomination.NominationID, nomineeID})
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.nominate_references",
				ActorUserID: user.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			if errors.Is(err, server.ErrConflict) {
				w.WriteHeader(http.StatusConflict)
				return
			}
			log.Error("failed to create nomination", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Cross-DB: populate the global reference_nominations_index so the
		// nominee (who may be in another region) can resolve each nomination.
		nominationIDs := make([]string, 0, len(created))
		for _, c := range created {
			nominationIDs = append(nominationIDs, c.nominationID.String())
			if idxErr := s.Global.InsertReferenceNominationIndex(ctx, globaldb.InsertReferenceNominationIndexParams{
				NominationID:           c.nominationID,
				NomineeHubUserGlobalID: c.nomineeID,
				Region:                 string(requestRegion),
				CandidacyID:            rr.CandidacyID,
				State:                  "nominated",
				CreatedAt:              pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
			}); idxErr != nil {
				s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to insert reference_nominations_index",
					"nomination_id", c.nominationID.String(), "error", idxErr)
			}
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{"nomination_ids": nominationIDs})
	}
}

func AcceptReferenceNomination(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		user := middleware.HubUserFromContext(ctx)
		if user == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.AcceptReferenceNominationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var nomID pgtype.UUID
		if err := nomID.Scan(req.NominationID); err != nil {
			http.Error(w, "invalid nomination_id", http.StatusBadRequest)
			return
		}

		region, _, nom, err := resolveReferenceNominationForNominee(ctx, s, nomID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to resolve nomination", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if nom.NomineeHubUserGlobalID != user.HubUserGlobalID {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if nom.State != "nominated" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		eventData, _ := json.Marshal(map[string]any{"nomination_id": req.NominationID})
		if err := s.WithRegionalTxFor(ctx, region, func(qtx *regionaldb.Queries) error {
			if _, txErr := qtx.UpdateReferenceNominationState(ctx, regionaldb.UpdateReferenceNominationStateParams{
				NominationID: nomID,
				State:        "accepted",
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.accept_reference_nomination",
				ActorUserID: user.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			log.Error("failed to accept nomination", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

func DeclineReferenceNomination(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		user := middleware.HubUserFromContext(ctx)
		if user == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.DeclineReferenceNominationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var nomID pgtype.UUID
		if err := nomID.Scan(req.NominationID); err != nil {
			http.Error(w, "invalid nomination_id", http.StatusBadRequest)
			return
		}

		region, _, nom, err := resolveReferenceNominationForNominee(ctx, s, nomID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to resolve nomination", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if nom.NomineeHubUserGlobalID != user.HubUserGlobalID {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		// Decline silently: the candidate receives no notification, but the
		// state change is still recorded in the regional audit log (the audit
		// log is internal and never surfaced to the candidate).
		if err := s.WithRegionalTxFor(ctx, region, func(qtx *regionaldb.Queries) error {
			if _, txErr := qtx.UpdateReferenceNominationState(ctx, regionaldb.UpdateReferenceNominationStateParams{
				NominationID: nomID,
				State:        "declined",
			}); txErr != nil {
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{
				"nomination_id": req.NominationID,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.decline_reference_nomination",
				ActorUserID: user.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			log.Error("failed to decline nomination", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

// resolveReferenceNominationForNominee resolves the region + regional DB that
// owns a reference nomination (via the global reference_nominations_index) and
// reads the nomination row. Returns pgx.ErrNoRows when the nomination is
// unknown. Used by the nominee-side accept/decline/submit handlers, whose
// caller may be in a different region from where the nomination lives.
func resolveReferenceNominationForNominee(
	ctx context.Context,
	s *server.RegionalServer,
	nominationID pgtype.UUID,
) (globaldb.Region, *regionaldb.Queries, regionaldb.ReferenceNomination, error) {
	region, err := regionForReferenceNomination(ctx, s, nominationID)
	if err != nil {
		return "", nil, regionaldb.ReferenceNomination{}, err
	}
	db := s.GetRegionalDB(region)
	if db == nil {
		return "", nil, regionaldb.ReferenceNomination{}, fmt.Errorf("unknown region %q", region)
	}
	nom, err := db.GetReferenceNomination(ctx, nominationID)
	if err != nil {
		return "", nil, regionaldb.ReferenceNomination{}, err
	}
	return region, db, nom, nil
}

func SubmitReferenceResponse(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		user := middleware.HubUserFromContext(ctx)
		if user == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.SubmitReferenceResponseRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var nomID pgtype.UUID
		if err := nomID.Scan(req.NominationID); err != nil {
			http.Error(w, "invalid nomination_id", http.StatusBadRequest)
			return
		}

		region, _, nom, err := resolveReferenceNominationForNominee(ctx, s, nomID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to resolve nomination", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if nom.NomineeHubUserGlobalID != user.HubUserGlobalID {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if nom.State != "accepted" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Check deadline
		if nom.ExpiresAt.Valid && nom.ExpiresAt.Time.Before(time.Now()) {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		eventData, _ := json.Marshal(map[string]any{"nomination_id": req.NominationID})
		if err := s.WithRegionalTxFor(ctx, region, func(qtx *regionaldb.Queries) error {
			for _, ans := range req.Answers {
				if txErr := qtx.InsertReferenceResponse(ctx, regionaldb.InsertReferenceResponseParams{
					NominationID: nomID,
					QuestionID:   ans.QuestionID,
					ResponseText: ans.ResponseText,
				}); txErr != nil {
					return txErr
				}
			}
			if _, txErr := qtx.UpdateReferenceNominationState(ctx, regionaldb.UpdateReferenceNominationStateParams{
				NominationID: nomID,
				State:        "submitted",
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.submit_reference_response",
				ActorUserID: user.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			log.Error("failed to submit reference response", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}
