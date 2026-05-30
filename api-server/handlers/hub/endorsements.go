package hub

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
	hub "vetchium-api-server.typespec/hub"
)

var (
	errNotOwner     = errors.New("not_owner")
	errWindowClosed = errors.New("window_closed")
	errNotConnected = errors.New("not_connected")
)

// RequestEndorsements sends endorsement requests for an application
func RequestEndorsements(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.RequestEndorsementsRequest
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

		var appIDUUID pgtype.UUID
		if err := appIDUUID.Scan(req.ApplicationID); err != nil {
			http.Error(w, "invalid application_id", http.StatusBadRequest)
			return
		}

		// Resolve application region from global index
		appIdx, err := s.Global.GetApplicationIndexEntry(ctx, appIDUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get application index entry", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Verify ownership
		if appIdx.HubUserGlobalID != hubUser.HubUserGlobalID {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		openingRegion := globaldb.Region(appIdx.Region)
		regionalDB := s.GetRegionalDB(openingRegion)
		if regionalDB == nil {
			log.Error("unknown region", "region", openingRegion)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Check application state
		app, err := regionalDB.GetApplicationByID(ctx, appIDUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get application", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if app.State != "applied" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Validate all endorser_handles are connected to the candidate in their home region
		homeDB := s.RegionalForCtx(ctx)
		peers, err := homeDB.GetConnectedPeersByHandles(ctx, regionaldb.GetConnectedPeersByHandlesParams{
			Me:      hubUser.HubUserGlobalID,
			Handles: req.EndorserHandles,
		})
		if err != nil {
			log.Error("failed to get connected peers", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		peerByHandle := map[string]pgtype.UUID{}
		for _, p := range peers {
			peerByHandle[p.PeerHandle] = p.Peer
		}
		var notConnected []string
		for _, h := range req.EndorserHandles {
			if _, ok := peerByHandle[h]; !ok {
				notConnected = append(notConnected, h)
			}
		}
		if len(notConnected) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":   "not_a_connection",
				"handles": notConnected,
			})
			return
		}

		// Create endorsement requests in the opening's regional tx + global index
		var note *string
		if req.Note != nil && *req.Note != "" {
			note = req.Note
		}

		var noteText pgtype.Text
		if note != nil {
			noteText = pgtype.Text{String: *note, Valid: true}
		}

		type createdRequest struct {
			requestID  pgtype.UUID
			endorserID pgtype.UUID
		}
		var created []createdRequest

		if err := s.WithRegionalTxFor(ctx, openingRegion, func(qtx *regionaldb.Queries) error {
			for _, h := range req.EndorserHandles {
				endorserID := peerByHandle[h]
				row, txErr := qtx.CreateEndorsementRequest(ctx, regionaldb.CreateEndorsementRequestParams{
					ApplicationID:           appIDUUID,
					EndorserHubUserGlobalID: endorserID,
					Note:                    noteText,
				})
				if txErr != nil {
					return txErr
				}
				created = append(created, createdRequest{requestID: row.RequestID, endorserID: endorserID})
			}

			eventData, _ := json.Marshal(map[string]interface{}{
				"application_id": req.ApplicationID,
				"endorser_count": len(req.EndorserHandles),
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.request_endorsement",
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
			log.Error("failed to create endorsement requests", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Write global index entries (compensating tx on failure is best-effort)
		for _, c := range created {
			if idxErr := s.Global.InsertEndorsementRequestIndex(ctx, globaldb.InsertEndorsementRequestIndexParams{
				RequestID:               c.requestID,
				EndorserHubUserGlobalID: c.endorserID,
				Region:                  string(openingRegion),
				ApplicationID:           appIDUUID,
				State:                   "pending",
				RequestedAt:             app.AppliedAt,
			}); idxErr != nil {
				log.Error("CONSISTENCY_ALERT: failed to insert endorsement request index", "error", idxErr)
			}
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

// ListEndorsementRequestsIncoming lists endorsement requests received by the hub user
func ListEndorsementRequestsIncoming(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.ListEndorsementRequestsIncomingRequest
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

		// Look up incoming requests from global index
		indexEntries, err := s.Global.ListEndorsementRequestsIndexByEndorser(ctx, globaldb.ListEndorsementRequestsIndexByEndorserParams{
			EndorserHubUserGlobalID: hubUser.HubUserGlobalID,
			Limit:                   limit,
		})
		if err != nil {
			log.Error("failed to list endorsement requests index", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// For now return skeleton — full implementation fetches from regional DBs per region
		var items []hub.EndorsementRequestIncoming
		for _, idx := range indexEntries {
			items = append(items, hub.EndorsementRequestIncoming{
				RequestID:     idx.RequestID.String(),
				ApplicationID: idx.ApplicationID.String(),
				State:         hub.EndorsementRequestState(idx.State),
				RequestedAt:   idx.RequestedAt.Time.Format("2006-01-02T15:04:05Z"),
			})
		}

		if items == nil {
			items = []hub.EndorsementRequestIncoming{}
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(hub.ListEndorsementRequestsIncomingResponse{
			Requests: items,
		})
	}
}

// ListEndorsementRequestsOutgoing lists endorsement requests sent by the hub user for an application
func ListEndorsementRequestsOutgoing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.ListEndorsementRequestsOutgoingRequest
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

		var appIDUUID pgtype.UUID
		if err := appIDUUID.Scan(req.ApplicationID); err != nil {
			http.Error(w, "invalid application_id", http.StatusBadRequest)
			return
		}

		// Resolve application region
		appIdx, err := s.Global.GetApplicationIndexEntry(ctx, appIDUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get application index entry", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if appIdx.HubUserGlobalID != hubUser.HubUserGlobalID {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		openingRegion := globaldb.Region(appIdx.Region)
		regionalDB := s.GetRegionalDB(openingRegion)
		if regionalDB == nil {
			log.Error("unknown region", "region", openingRegion)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		rows, err := regionalDB.ListEndorsementRequestsForApplication(ctx, appIDUUID)
		if err != nil {
			log.Error("failed to list endorsement requests", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		items := make([]hub.EndorsementRequestOutgoing, 0, len(rows))
		for _, row := range rows {
			items = append(items, hub.EndorsementRequestOutgoing{
				RequestID:     row.RequestID.String(),
				ApplicationID: row.ApplicationID.String(),
				State:         hub.EndorsementRequestState(row.State),
				RequestedAt:   row.RequestedAt.Time.Format("2006-01-02T15:04:05Z"),
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(hub.ListEndorsementRequestsOutgoingResponse{
			Requests: items,
		})
	}
}

// WriteEndorsement writes an endorsement (in response to a request or unsolicited)
func WriteEndorsement(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.WriteEndorsementRequest
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

		var appIDUUID pgtype.UUID
		var requestIDUUID pgtype.UUID
		var openingRegion globaldb.Region
		var isUnsolicited bool

		if req.RequestID != nil {
			// Resolve via endorsement request index
			if err := requestIDUUID.Scan(*req.RequestID); err != nil {
				http.Error(w, "invalid request_id", http.StatusBadRequest)
				return
			}
			idxEntry, err := s.Global.GetEndorsementRequestIndexEntry(ctx, requestIDUUID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				log.Error("failed to get endorsement request index", "error", err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			if idxEntry.EndorserHubUserGlobalID != hubUser.HubUserGlobalID {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			openingRegion = globaldb.Region(idxEntry.Region)
			appIDUUID = idxEntry.ApplicationID
		} else {
			// Unsolicited path — resolve via application index
			if err := appIDUUID.Scan(*req.ApplicationID); err != nil {
				http.Error(w, "invalid application_id", http.StatusBadRequest)
				return
			}
			appIdx, err := s.Global.GetApplicationIndexEntry(ctx, appIDUUID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				log.Error("failed to get application index", "error", err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			openingRegion = globaldb.Region(appIdx.Region)
			isUnsolicited = true
		}

		regionalDB := s.GetRegionalDB(openingRegion)
		if regionalDB == nil {
			log.Error("unknown region", "region", openingRegion)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		app, err := regionalDB.GetApplicationByID(ctx, appIDUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get application", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Check connection status in endorser's home region
		homeDB := s.RegionalForCtx(ctx)
		edge, err := homeDB.GetUserConnectionEdge(ctx, regionaldb.GetUserConnectionEdgeParams{
			Me:   hubUser.HubUserGlobalID,
			Peer: app.ApplicantHubUserGlobalID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Also check reverse direction
				edge, err = homeDB.GetUserConnectionEdge(ctx, regionaldb.GetUserConnectionEdgeParams{
					Me:   app.ApplicantHubUserGlobalID,
					Peer: hubUser.HubUserGlobalID,
				})
				if err != nil {
					w.WriteHeader(http.StatusForbidden)
					return
				}
			} else {
				log.Error("failed to check connection", "error", err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
		}
		if edge.Status != "connected" {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		// For unsolicited, check candidate opted in
		if isUnsolicited {
			prefs, err := homeDB.GetHubApplyPreferences(ctx, app.ApplicantHubUserGlobalID)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				log.Error("failed to get apply preferences", "error", err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			if errors.Is(err, pgx.ErrNoRows) || !prefs.AllowUnsolicitedEndorsements {
				w.WriteHeader(http.StatusForbidden)
				return
			}
		}

		// Window check: can only write while application is in 'applied'
		if app.State != "applied" && req.RequestID != nil {
			// Check if there's a pending request (if request exists but app moved, still allow writing if request is pending)
			erReq, reqErr := regionalDB.GetEndorsementRequestByID(ctx, requestIDUUID)
			if reqErr != nil || erReq.State != "pending" {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
		} else if app.State != "applied" && isUnsolicited {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Get shared work domain context
		sharedCtx, err := homeDB.GetSharedWorkDomain(ctx, regionaldb.GetSharedWorkDomainParams{
			HubUserID:   hubUser.HubUserGlobalID,
			HubUserID_2: app.ApplicantHubUserGlobalID,
		})
		if err != nil {
			log.Error("failed to get shared work domain", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var endorsement regionaldb.Endorsement

		if err := s.WithRegionalTxFor(ctx, openingRegion, func(qtx *regionaldb.Queries) error {
			var txErr error
			endorsement, txErr = qtx.CreateEndorsement(ctx, regionaldb.CreateEndorsementParams{
				ApplicationID:           appIDUUID,
				EndorserHubUserGlobalID: hubUser.HubUserGlobalID,
				RequestID:               requestIDUUID,
				IsReferral:              false,
				ReferralID:              pgtype.UUID{},
				SharedDomain:            sharedCtx.SharedDomain,
				OverlapStartYear:        sharedCtx.OverlapStartYear,
				OverlapEndYear:          sharedCtx.OverlapEndYear,
				Text:                    req.Text,
			})
			if txErr != nil {
				return txErr
			}

			// Mark request as written if applicable
			if requestIDUUID.Valid {
				if _, txErr = qtx.ResolveEndorsementRequestWritten(ctx, requestIDUUID); txErr != nil {
					return txErr
				}
			}

			eventData, _ := json.Marshal(map[string]interface{}{
				"endorsement_id": endorsement.EndorsementID.String(),
				"application_id": appIDUUID.String(),
				"is_referral":    false,
				"is_unsolicited": isUnsolicited,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.write_endorsement",
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
			log.Error("failed to write endorsement", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Update global index state if request resolved
		if requestIDUUID.Valid {
			if idxErr := s.Global.UpdateEndorsementRequestIndexState(ctx, globaldb.UpdateEndorsementRequestIndexStateParams{
				RequestID: requestIDUUID,
				State:     "written",
			}); idxErr != nil {
				log.Error("CONSISTENCY_ALERT: failed to update endorsement request index state", "error", idxErr)
			}
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(hub.WriteEndorsementResponse{
			EndorsementID: endorsement.EndorsementID.String(),
		})
	}
}

// UpdateEndorsement updates an existing endorsement
func UpdateEndorsement(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.UpdateEndorsementRequest
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

		var endorsementIDUUID pgtype.UUID
		if err := endorsementIDUUID.Scan(req.EndorsementID); err != nil {
			http.Error(w, "invalid endorsement_id", http.StatusBadRequest)
			return
		}

		// The endorsement lives in the opening's region. The endorser is not
		// necessarily an applicant anywhere, so there is no application-index
		// anchor for them — probe all configured regions (≤3) for the
		// endorsement, which is keyed by an id unique to a single region.
		var openingRegion globaldb.Region
		var regionalDB *regionaldb.Queries
		var endorsement regionaldb.Endorsement
		for _, region := range allConfiguredRegions(s) {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			got, qErr := rdb.GetEndorsementByID(ctx, endorsementIDUUID)
			if qErr == nil {
				openingRegion = region
				regionalDB = rdb
				endorsement = got
				break
			}
			if !errors.Is(qErr, pgx.ErrNoRows) {
				log.Error("failed to get endorsement", "region", region, "error", qErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
		}
		if regionalDB == nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Ownership check
		if endorsement.EndorserHubUserGlobalID != hubUser.HubUserGlobalID {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Window check: the endorsement is editable only while the application
		// is still `applied`.
		app, err := regionalDB.GetApplicationByID(ctx, endorsement.ApplicationID)
		if err != nil {
			log.Error("failed to get application", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if app.State != "applied" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		if err := s.WithRegionalTxFor(ctx, openingRegion, func(qtx *regionaldb.Queries) error {
			if _, txErr := qtx.UpdateEndorsement(ctx, regionaldb.UpdateEndorsementParams{
				EndorsementID: endorsementIDUUID,
				Text:          req.Text,
			}); txErr != nil {
				return txErr
			}
			eventData, _ := json.Marshal(map[string]interface{}{
				"endorsement_id": req.EndorsementID,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.update_endorsement",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			log.Error("failed to update endorsement", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

// DeclineEndorsementRequest declines an endorsement request silently
func DeclineEndorsementRequest(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.DeclineEndorsementRequestRequest
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

		var requestIDUUID pgtype.UUID
		if err := requestIDUUID.Scan(req.RequestID); err != nil {
			http.Error(w, "invalid request_id", http.StatusBadRequest)
			return
		}

		// Resolve via global index
		idxEntry, err := s.Global.GetEndorsementRequestIndexEntry(ctx, requestIDUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get endorsement request index", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if idxEntry.EndorserHubUserGlobalID != hubUser.HubUserGlobalID {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		openingRegion := globaldb.Region(idxEntry.Region)

		if err := s.WithRegionalTxFor(ctx, openingRegion, func(qtx *regionaldb.Queries) error {
			erReq, txErr := qtx.GetEndorsementRequestByID(ctx, requestIDUUID)
			if txErr != nil {
				return txErr
			}
			if erReq.State != "pending" {
				return errWindowClosed
			}
			if _, txErr = qtx.ResolveEndorsementRequestDeclined(ctx, requestIDUUID); txErr != nil {
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{
				"request_id": req.RequestID,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.decline_endorsement_request",
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
			log.Error("failed to decline endorsement request", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Update global index
		if idxErr := s.Global.UpdateEndorsementRequestIndexState(ctx, globaldb.UpdateEndorsementRequestIndexStateParams{
			RequestID: requestIDUUID,
			State:     "declined",
		}); idxErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to update endorsement request index state", "error", idxErr)
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

// HideEndorsementOnApplication hides an endorsement from the org view
func HideEndorsementOnApplication(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.HideEndorsementOnApplicationRequest
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

		var endorsementIDUUID pgtype.UUID
		if err := endorsementIDUUID.Scan(req.EndorsementID); err != nil {
			http.Error(w, "invalid endorsement_id", http.StatusBadRequest)
			return
		}

		err := hideOrShowEndorsementHelper(ctx, r, s, hubUser.HubUserGlobalID, endorsementIDUUID, true)
		if err != nil {
			switch {
			case errors.Is(err, errNotOwner):
				w.WriteHeader(http.StatusNotFound)
			case errors.Is(err, errWindowClosed):
				w.WriteHeader(http.StatusUnprocessableEntity)
			default:
				log.Error("failed to hide endorsement", "error", err)
				w.WriteHeader(http.StatusInternalServerError)
			}
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

// ShowEndorsementOnApplication re-shows a previously hidden endorsement
func ShowEndorsementOnApplication(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.ShowEndorsementOnApplicationRequest
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

		var endorsementIDUUID pgtype.UUID
		if err := endorsementIDUUID.Scan(req.EndorsementID); err != nil {
			http.Error(w, "invalid endorsement_id", http.StatusBadRequest)
			return
		}

		err := hideOrShowEndorsementHelper(ctx, r, s, hubUser.HubUserGlobalID, endorsementIDUUID, false)
		if err != nil {
			switch {
			case errors.Is(err, errNotOwner):
				w.WriteHeader(http.StatusNotFound)
			case errors.Is(err, errWindowClosed):
				w.WriteHeader(http.StatusUnprocessableEntity)
			default:
				log.Error("failed to show endorsement", "error", err)
				w.WriteHeader(http.StatusInternalServerError)
			}
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

func hideOrShowEndorsementHelper(ctx context.Context, r *http.Request, s *server.RegionalServer, callerID pgtype.UUID, endorsementIDUUID pgtype.UUID, hide bool) error {
	eventType := "hub.show_endorsement"
	if hide {
		eventType = "hub.hide_endorsement"
	}
	// The endorsement lives in the opening's region (its application's region),
	// which may differ from the candidate's home region and has no dedicated
	// global index. Probe the candidate's hiring regions: in each, attempt the
	// owner-scoped hide/show inside a tx that also writes the audit log. The
	// region where the endorsement exists commits; others roll back as no-ops.
	regions, err := hubUserHiringRegions(ctx, s, callerID)
	if err != nil {
		return err
	}
	for _, region := range regions {
		rdb := s.GetRegionalDB(region)
		if rdb == nil {
			continue
		}
		txErr := s.WithRegionalTxFor(ctx, region, func(qtx *regionaldb.Queries) error {
			var e error
			if hide {
				_, e = qtx.HideEndorsementIfOwner(ctx, regionaldb.HideEndorsementIfOwnerParams{
					EndorsementID:            endorsementIDUUID,
					ApplicantHubUserGlobalID: callerID,
				})
			} else {
				_, e = qtx.ShowEndorsementIfOwner(ctx, regionaldb.ShowEndorsementIfOwnerParams{
					EndorsementID:            endorsementIDUUID,
					ApplicantHubUserGlobalID: callerID,
				})
			}
			if errors.Is(e, pgx.ErrNoRows) {
				return errNotOwner // not in this region — roll back and try next
			}
			if e != nil {
				return e
			}
			eventData, _ := json.Marshal(map[string]any{
				"endorsement_id": endorsementIDUUID.String(),
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   eventType,
				ActorUserID: callerID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if txErr == nil {
			return nil
		}
		if errors.Is(txErr, errNotOwner) {
			continue
		}
		return txErr
	}
	return errNotOwner
}
