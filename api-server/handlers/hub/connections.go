package hub

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
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
	"vetchium-api-server.gomodule/internal/email/templates"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	hubtypes "vetchium-api-server.typespec/hub"
)

// Custom 4xx connection error codes
const (
	httpStatusSelf               = 452 // Self-targeting
	httpStatusIneligible         = 453 // No shared employer domain with overlapping tenure
	httpStatusStateConflict      = 454 // pending/connected record already exists
	httpStatusRequesterBarred    = 455 // target previously rejected this requester
	httpStatusDisconnectedBarred = 456 // target disconnected from this requester
	httpStatusCallerBlocked      = 457 // caller has blocked the target
	httpStatusAlreadyBlocked     = 458 // caller already blocked this user
	httpStatusNotBlocked         = 459 // not blocked
	httpStatusTargetBlocked      = 460 // target has blocked the caller
)

// hashUserID computes SHA-256 of the UUID bytes for audit event_data.
func hashUserID(id pgtype.UUID) string {
	h := sha256.Sum256(id.Bytes[:])
	return fmt.Sprintf("%x", h)
}

// uuidEqual compares two pgtype.UUIDs for equality.
func uuidEqual(a, b pgtype.UUID) bool {
	return a.Valid && b.Valid && a.Bytes == b.Bytes
}

// stintOverlaps checks if any of A's stints overlaps with any of B's stints on a shared domain.
func stintOverlaps(
	aStints []regionaldb.GetUserEligibilityStintsRow,
	bStints []regionaldb.GetUserEligibilityStintsRow,
) bool {
	bByDomain := make(map[string][]regionaldb.GetUserEligibilityStintsRow)
	for _, s := range bStints {
		bByDomain[s.Domain] = append(bByDomain[s.Domain], s)
	}

	for _, a := range aStints {
		bs, ok := bByDomain[a.Domain]
		if !ok {
			continue
		}
		aStart := a.FirstVerifiedAt.Time
		var aEnd time.Time
		if a.Status == regionaldb.WorkEmailStintStatusActive {
			aEnd = time.Now().UTC()
		} else if a.EndedAt.Valid {
			aEnd = a.EndedAt.Time
		} else if a.LastVerifiedAt.Valid {
			aEnd = a.LastVerifiedAt.Time
		} else {
			aEnd = aStart
		}

		for _, b := range bs {
			bStart := b.FirstVerifiedAt.Time
			var bEnd time.Time
			if b.Status == regionaldb.WorkEmailStintStatusActive {
				bEnd = time.Now().UTC()
			} else if b.EndedAt.Valid {
				bEnd = b.EndedAt.Time
			} else if b.LastVerifiedAt.Valid {
				bEnd = b.LastVerifiedAt.Time
			} else {
				bEnd = bStart
			}
			if !aStart.After(bEnd) && !bStart.After(aEnd) {
				return true
			}
		}
	}
	return false
}

// getPreferredDisplayName picks the preferred display name from a list.
func getPreferredDisplayName(displayNames []globaldb.HubUserDisplayName) string {
	for _, dn := range displayNames {
		if dn.IsPreferred {
			return dn.DisplayName
		}
	}
	if len(displayNames) > 0 {
		return displayNames[0].DisplayName
	}
	return ""
}

// connectionCursor is used for keyset pagination.
type connectionCursor struct {
	Timestamp  time.Time
	PeerUserID [16]byte
}

func encodeConnectionCursor(ts time.Time, peerID pgtype.UUID) string {
	raw := fmt.Sprintf("%s|%x", ts.UTC().Format(time.RFC3339Nano), peerID.Bytes)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeConnectionCursor(key string) (connectionCursor, error) {
	b, err := base64.RawURLEncoding.DecodeString(key)
	if err != nil {
		return connectionCursor{}, err
	}
	s := string(b)
	idx := len(s) - 33 // 32 hex chars + 1 pipe
	if idx < 0 || s[idx] != '|' {
		return connectionCursor{}, fmt.Errorf("invalid cursor format")
	}
	ts, err := time.Parse(time.RFC3339Nano, s[:idx])
	if err != nil {
		return connectionCursor{}, err
	}
	var id [16]byte
	hexStr := s[idx+1:]
	for i := range 16 {
		fmt.Sscanf(hexStr[i*2:i*2+2], "%02x", &id[i])
	}
	return connectionCursor{Timestamp: ts, PeerUserID: id}, nil
}

const defaultConnectionListLimit = 25
const maxConnectionListLimit = 100

// SendConnectionRequest handles POST /hub/connections/send-request
func SendConnectionRequest(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.HandleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		targetGlobal, err := s.Global.GetHubUserByHandle(ctx, string(req.Handle))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to resolve target handle", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if uuidEqual(hubUser.HubUserGlobalID, targetGlobal.HubUserGlobalID) {
			w.WriteHeader(httpStatusSelf)
			return
		}

		// Block check via global routing table (single query covers both directions)
		blockRoutes, err := s.Global.GetBlockRoutes(ctx, globaldb.GetBlockRoutesParams{
			A: hubUser.HubUserGlobalID,
			B: targetGlobal.HubUserGlobalID,
		})
		if err != nil {
			log.Error("failed to check block routes", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		for _, br := range blockRoutes {
			if uuidEqual(br.BlockerUserID, hubUser.HubUserGlobalID) {
				w.WriteHeader(httpStatusCallerBlocked)
				return
			}
			if uuidEqual(br.BlockerUserID, targetGlobal.HubUserGlobalID) {
				w.WriteHeader(httpStatusTargetBlocked)
				return
			}
		}

		// Eligibility check (cross-region stints)
		callerStints, err := s.RegionalForCtx(ctx).GetUserEligibilityStints(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			log.Error("failed to get caller stints", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		var targetStints []regionaldb.GetUserEligibilityStintsRow
		targetRegDB := s.GetRegionalDB(targetGlobal.HomeRegion)
		if targetRegDB == nil {
			log.Error("no regional pool for target home region", "region", targetGlobal.HomeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		targetStints, err = targetRegDB.GetUserEligibilityStints(ctx, targetGlobal.HubUserGlobalID)
		if err != nil {
			log.Error("failed to get target stints", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if !stintOverlaps(callerStints, targetStints) {
			w.WriteHeader(httpStatusIneligible)
			return
		}

		// State precondition check on caller's own edge (always in own home region)
		ownEdge, err := s.RegionalForCtx(ctx).GetUserConnectionEdge(ctx, regionaldb.GetUserConnectionEdgeParams{
			Me:   hubUser.HubUserGlobalID,
			Peer: targetGlobal.HubUserGlobalID,
		})
		if err == nil {
			switch ownEdge.Status {
			case regionaldb.HubUserConnectionStatusOutgoingPending,
				regionaldb.HubUserConnectionStatusIncomingPending,
				regionaldb.HubUserConnectionStatusConnected:
				w.WriteHeader(httpStatusStateConflict)
				return
			case regionaldb.HubUserConnectionStatusTheyRejected:
				w.WriteHeader(httpStatusRequesterBarred)
				return
			case regionaldb.HubUserConnectionStatusTheyDisconnected:
				w.WriteHeader(httpStatusDisconnectedBarred)
				return
				// i_rejected and i_disconnected: caller may re-request
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to get own connection edge", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Fetch names/email for notification
		callerDisplayNames, err := s.Global.ListHubUserDisplayNames(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			log.Error("failed to get caller display names", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		callerName := getPreferredDisplayName(callerDisplayNames)
		if callerName == "" {
			callerName = string(hubUser.Handle)
		}

		var targetEmail string
		if targetUser, err := targetRegDB.GetHubUserByGlobalID(ctx, targetGlobal.HubUserGlobalID); err == nil {
			targetEmail = targetUser.EmailAddress
		}

		peerIDHash := hashUserID(targetGlobal.HubUserGlobalID)
		auditData, _ := json.Marshal(map[string]any{"peer_user_id_hash": peerIDHash})

		// Write caller's own outgoing edge (own region, with audit log)
		ownErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if err := qtx.UpsertPendingEdge(ctx, regionaldb.UpsertPendingEdgeParams{
				Me:         hubUser.HubUserGlobalID,
				Peer:       targetGlobal.HubUserGlobalID,
				PeerHandle: string(targetGlobal.Handle),
				Status:     regionaldb.HubUserConnectionStatusOutgoingPending,
			}); err != nil {
				return err
			}

			if targetEmail != "" {
				emailData := templates.HubConnectionRequestData{RequesterName: callerName}
				if _, err := qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
					EmailType:     regionaldb.EmailTemplateTypeHubConnectionRequest,
					EmailTo:       targetEmail,
					EmailSubject:  templates.HubConnectionRequestSubject(),
					EmailTextBody: templates.HubConnectionRequestTextBody(emailData),
					EmailHtmlBody: templates.HubConnectionRequestHTMLBody(emailData),
				}); err != nil {
					return err
				}
			}

			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.send_connection_request",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})
		if ownErr != nil {
			log.Error("failed to write own connection edge", "error", ownErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Write target's incoming edge (foreign region, best-effort with compensation)
		peerErr := targetRegDB.UpsertPendingEdge(ctx, regionaldb.UpsertPendingEdgeParams{
			Me:         targetGlobal.HubUserGlobalID,
			Peer:       hubUser.HubUserGlobalID,
			PeerHandle: string(hubUser.Handle),
			Status:     regionaldb.HubUserConnectionStatusIncomingPending,
		})
		if peerErr != nil {
			// Compensate: remove own edge
			compErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
				_, err := qtx.DeleteUserConnectionEdge(ctx, regionaldb.DeleteUserConnectionEdgeParams{
					Me:   hubUser.HubUserGlobalID,
					Peer: targetGlobal.HubUserGlobalID,
				})
				return err
			})
			if compErr != nil {
				log.Error("CONSISTENCY_ALERT: failed to compensate own edge after peer write failure",
					"error", compErr, "original_error", peerErr)
			} else {
				log.Error("failed to write peer incoming edge, compensated own edge", "error", peerErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{})
	}
}

// AcceptConnectionRequest handles POST /hub/connections/accept-request
func AcceptConnectionRequest(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.HandleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		peerGlobal, err := s.Global.GetHubUserByHandle(ctx, string(req.Handle))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to resolve handle", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		peerDB := s.GetRegionalDB(peerGlobal.HomeRegion)
		if peerDB == nil {
			log.Error("no regional pool for peer home region", "region", peerGlobal.HomeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify accepter's own edge is incoming_pending before touching peer's region
		ownEdge, err := s.RegionalForCtx(ctx).GetUserConnectionEdge(ctx, regionaldb.GetUserConnectionEdgeParams{
			Me:   hubUser.HubUserGlobalID,
			Peer: peerGlobal.HubUserGlobalID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get own edge", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if ownEdge.Status != regionaldb.HubUserConnectionStatusIncomingPending {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		connectedAt := pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
		peerIDHash := hashUserID(peerGlobal.HubUserGlobalID)

		// Get peer's email for notification
		var peerEmail string
		if peerUser, peerErr := peerDB.GetHubUserByGlobalID(ctx, peerGlobal.HubUserGlobalID); peerErr == nil {
			peerEmail = peerUser.EmailAddress
		}

		callerDisplayNames, _ := s.Global.ListHubUserDisplayNames(ctx, hubUser.HubUserGlobalID)
		callerName := getPreferredDisplayName(callerDisplayNames)
		if callerName == "" {
			callerName = string(hubUser.Handle)
		}

		// Write peer's outgoing edge first (foreign region, no audit)
		peerRows, err := peerDB.SetConnectionConnected(ctx, regionaldb.SetConnectionConnectedParams{
			ConnectedAt: connectedAt,
			Me:          peerGlobal.HubUserGlobalID,
			Peer:        hubUser.HubUserGlobalID,
		})
		if err != nil {
			log.Error("failed to update peer edge to connected", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if peerRows == 0 {
			// Peer's edge was not in pending state; treat as not found
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Write own incoming edge (own region, with audit)
		auditData, _ := json.Marshal(map[string]any{
			"peer_user_id_hash": peerIDHash,
			"connected_at":      connectedAt.Time.UTC().Format(time.RFC3339),
		})
		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			ownRows, err := qtx.SetConnectionConnected(ctx, regionaldb.SetConnectionConnectedParams{
				ConnectedAt: connectedAt,
				Me:          hubUser.HubUserGlobalID,
				Peer:        peerGlobal.HubUserGlobalID,
			})
			if err != nil {
				return err
			}
			if ownRows == 0 {
				return errNotFound
			}

			if peerEmail != "" {
				emailData := templates.HubConnectionAcceptedData{AccepterName: callerName}
				if _, err := qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
					EmailType:     regionaldb.EmailTemplateTypeHubConnectionAccepted,
					EmailTo:       peerEmail,
					EmailSubject:  templates.HubConnectionAcceptedSubject(),
					EmailTextBody: templates.HubConnectionAcceptedTextBody(emailData),
					EmailHtmlBody: templates.HubConnectionAcceptedHTMLBody(emailData),
				}); err != nil {
					return err
				}
			}

			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.accept_connection_request",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})
		if txErr != nil {
			// Compensate: revert peer's edge back to outgoing_pending
			compErr := peerDB.RevertEdgeToPending(ctx, regionaldb.RevertEdgeToPendingParams{
				PendingStatus: regionaldb.HubUserConnectionStatusOutgoingPending,
				Me:            peerGlobal.HubUserGlobalID,
				Peer:          hubUser.HubUserGlobalID,
			})
			if compErr != nil {
				log.Error("CONSISTENCY_ALERT: failed to compensate peer edge after own write failure",
					"error", compErr, "original_error", txErr)
			}
			if errors.Is(txErr, errNotFound) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to update own edge to connected", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{})
	}
}

var errNotFound = errors.New("not found")

// RejectConnectionRequest handles POST /hub/connections/reject-request
func RejectConnectionRequest(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.HandleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		peerGlobal, err := s.Global.GetHubUserByHandle(ctx, string(req.Handle))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to resolve handle", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		peerDB := s.GetRegionalDB(peerGlobal.HomeRegion)
		if peerDB == nil {
			log.Error("no regional pool for peer home region", "region", peerGlobal.HomeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify own edge is incoming_pending
		ownEdge, err := s.RegionalForCtx(ctx).GetUserConnectionEdge(ctx, regionaldb.GetUserConnectionEdgeParams{
			Me:   hubUser.HubUserGlobalID,
			Peer: peerGlobal.HubUserGlobalID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get own edge", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if ownEdge.Status != regionaldb.HubUserConnectionStatusIncomingPending {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		peerIDHash := hashUserID(peerGlobal.HubUserGlobalID)
		auditData, _ := json.Marshal(map[string]any{"peer_user_id_hash": peerIDHash})

		// Update peer's outgoing edge to they_rejected (foreign region, no audit)
		peerRows, err := peerDB.UpdateEdgeStatus(ctx, regionaldb.UpdateEdgeStatusParams{
			NewStatus:      regionaldb.HubUserConnectionStatusTheyRejected,
			Me:             peerGlobal.HubUserGlobalID,
			Peer:           hubUser.HubUserGlobalID,
			ExpectedStatus: regionaldb.HubUserConnectionStatusOutgoingPending,
		})
		if err != nil {
			log.Error("failed to update peer edge to they_rejected", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if peerRows == 0 {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Update own edge to i_rejected (own region, with audit)
		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			ownRows, err := qtx.UpdateEdgeStatus(ctx, regionaldb.UpdateEdgeStatusParams{
				NewStatus:      regionaldb.HubUserConnectionStatusIRejected,
				Me:             hubUser.HubUserGlobalID,
				Peer:           peerGlobal.HubUserGlobalID,
				ExpectedStatus: regionaldb.HubUserConnectionStatusIncomingPending,
			})
			if err != nil {
				return err
			}
			if ownRows == 0 {
				return errNotFound
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.reject_connection_request",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})
		if txErr != nil {
			// Compensate: revert peer's edge to outgoing_pending
			compErr := peerDB.RevertEdgeToPending(ctx, regionaldb.RevertEdgeToPendingParams{
				PendingStatus: regionaldb.HubUserConnectionStatusOutgoingPending,
				Me:            peerGlobal.HubUserGlobalID,
				Peer:          hubUser.HubUserGlobalID,
			})
			if compErr != nil {
				log.Error("CONSISTENCY_ALERT: failed to compensate peer edge after reject failure",
					"error", compErr, "original_error", txErr)
			}
			if errors.Is(txErr, errNotFound) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to update own edge to i_rejected", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// WithdrawConnectionRequest handles POST /hub/connections/withdraw-request
func WithdrawConnectionRequest(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.HandleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		peerGlobal, err := s.Global.GetHubUserByHandle(ctx, string(req.Handle))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to resolve handle", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		peerDB := s.GetRegionalDB(peerGlobal.HomeRegion)
		if peerDB == nil {
			log.Error("no regional pool for peer home region", "region", peerGlobal.HomeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify own edge is outgoing_pending before making any changes
		ownEdge, err := s.RegionalForCtx(ctx).GetUserConnectionEdge(ctx, regionaldb.GetUserConnectionEdgeParams{
			Me:   hubUser.HubUserGlobalID,
			Peer: peerGlobal.HubUserGlobalID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get own edge", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if ownEdge.Status != regionaldb.HubUserConnectionStatusOutgoingPending {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		peerIDHash := hashUserID(peerGlobal.HubUserGlobalID)
		auditData, _ := json.Marshal(map[string]any{"peer_user_id_hash": peerIDHash})

		// Delete own outgoing edge (own region, with audit)
		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			rows, err := qtx.DeleteUserConnectionEdge(ctx, regionaldb.DeleteUserConnectionEdgeParams{
				Me:   hubUser.HubUserGlobalID,
				Peer: peerGlobal.HubUserGlobalID,
			})
			if err != nil {
				return err
			}
			if rows == 0 {
				return errNotFound
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.withdraw_connection_request",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})
		if txErr != nil {
			if errors.Is(txErr, errNotFound) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to delete own edge", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Delete peer's incoming edge (foreign region, best-effort)
		if err := peerDB.DeleteUserConnectionEdgeForBlock(ctx, regionaldb.DeleteUserConnectionEdgeForBlockParams{
			Me:   peerGlobal.HubUserGlobalID,
			Peer: hubUser.HubUserGlobalID,
		}); err != nil {
			log.Error("CONSISTENCY_ALERT: failed to delete peer's incoming edge after withdraw",
				"error", err)
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// DisconnectConnection handles POST /hub/connections/disconnect
func DisconnectConnection(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.HandleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		peerGlobal, err := s.Global.GetHubUserByHandle(ctx, string(req.Handle))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to resolve handle", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		peerDB := s.GetRegionalDB(peerGlobal.HomeRegion)
		if peerDB == nil {
			log.Error("no regional pool for peer home region", "region", peerGlobal.HomeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		peerIDHash := hashUserID(peerGlobal.HubUserGlobalID)
		auditData, _ := json.Marshal(map[string]any{"peer_user_id_hash": peerIDHash})

		// Update own edge to i_disconnected (own region, with audit)
		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			rows, err := qtx.UpdateEdgeStatus(ctx, regionaldb.UpdateEdgeStatusParams{
				NewStatus:      regionaldb.HubUserConnectionStatusIDisconnected,
				Me:             hubUser.HubUserGlobalID,
				Peer:           peerGlobal.HubUserGlobalID,
				ExpectedStatus: regionaldb.HubUserConnectionStatusConnected,
			})
			if err != nil {
				return err
			}
			if rows == 0 {
				return errNotFound
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.disconnect_connection",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})
		if txErr != nil {
			if errors.Is(txErr, errNotFound) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to disconnect connection", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update peer's edge to they_disconnected (foreign region, best-effort)
		_, err = peerDB.UpdateEdgeStatus(ctx, regionaldb.UpdateEdgeStatusParams{
			NewStatus:      regionaldb.HubUserConnectionStatusTheyDisconnected,
			Me:             peerGlobal.HubUserGlobalID,
			Peer:           hubUser.HubUserGlobalID,
			ExpectedStatus: regionaldb.HubUserConnectionStatusConnected,
		})
		if err != nil {
			log.Error("CONSISTENCY_ALERT: failed to update peer edge to they_disconnected",
				"error", err)
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// BlockHubUser handles POST /hub/connections/block
func BlockHubUser(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.HandleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		targetGlobal, err := s.Global.GetHubUserByHandle(ctx, string(req.Handle))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to resolve handle", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if uuidEqual(hubUser.HubUserGlobalID, targetGlobal.HubUserGlobalID) {
			w.WriteHeader(httpStatusSelf)
			return
		}

		peerIDHash := hashUserID(targetGlobal.HubUserGlobalID)
		auditData, _ := json.Marshal(map[string]any{"peer_user_id_hash": peerIDHash})

		// Write global block route first
		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.UpsertBlockRoute(ctx, globaldb.UpsertBlockRouteParams{
				Blocker: hubUser.HubUserGlobalID,
				Blocked: targetGlobal.HubUserGlobalID,
				Region:  middleware.HubRegionFromContext(ctx),
			})
		})
		if err != nil {
			log.Error("failed to upsert block route", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Write own region: insert block, remove own connection edge, audit log
		var alreadyBlocked bool
		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			block, err := qtx.InsertBlock(ctx, regionaldb.InsertBlockParams{
				Blocker: hubUser.HubUserGlobalID,
				Blocked: targetGlobal.HubUserGlobalID,
			})
			if err != nil {
				return err
			}
			if !block.BlockerUserID.Valid {
				alreadyBlocked = true
				return nil
			}

			if err := qtx.DeleteUserConnectionEdgeForBlock(ctx, regionaldb.DeleteUserConnectionEdgeForBlockParams{
				Me:   hubUser.HubUserGlobalID,
				Peer: targetGlobal.HubUserGlobalID,
			}); err != nil {
				return err
			}

			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.block_hub_user",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})
		if txErr != nil {
			// Compensate global block route
			compErr := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
				return qtx.DeleteBlockRoute(ctx, globaldb.DeleteBlockRouteParams{
					Blocker: hubUser.HubUserGlobalID,
					Blocked: targetGlobal.HubUserGlobalID,
				})
			})
			if compErr != nil {
				log.Error("CONSISTENCY_ALERT: failed to compensate block route",
					"error", compErr, "original_error", txErr)
			}
			log.Error("failed to block user", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if alreadyBlocked {
			w.WriteHeader(httpStatusAlreadyBlocked)
			return
		}

		// Best-effort: remove target's connection edge from their region
		if targetDB := s.GetRegionalDB(targetGlobal.HomeRegion); targetDB != nil {
			if err := targetDB.DeleteUserConnectionEdgeForBlock(ctx, regionaldb.DeleteUserConnectionEdgeForBlockParams{
				Me:   targetGlobal.HubUserGlobalID,
				Peer: hubUser.HubUserGlobalID,
			}); err != nil {
				log.Error("CONSISTENCY_ALERT: failed to remove target's connection edge after block",
					"error", err)
			}
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{})
	}
}

// UnblockHubUser handles POST /hub/connections/unblock
func UnblockHubUser(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.HandleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		targetGlobal, err := s.Global.GetHubUserByHandle(ctx, string(req.Handle))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(httpStatusNotBlocked)
				return
			}
			log.Error("failed to resolve handle", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		peerIDHash := hashUserID(targetGlobal.HubUserGlobalID)
		auditData, _ := json.Marshal(map[string]any{"peer_user_id_hash": peerIDHash})

		var rowsDeleted int64
		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			rows, err := qtx.DeleteBlock(ctx, regionaldb.DeleteBlockParams{
				Blocker: hubUser.HubUserGlobalID,
				Blocked: targetGlobal.HubUserGlobalID,
			})
			if err != nil {
				return err
			}
			rowsDeleted = rows
			if rows == 0 {
				return nil
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.unblock_hub_user",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})
		if txErr != nil {
			log.Error("failed to unblock user", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if rowsDeleted == 0 {
			w.WriteHeader(httpStatusNotBlocked)
			return
		}

		if err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.DeleteBlockRoute(ctx, globaldb.DeleteBlockRouteParams{
				Blocker: hubUser.HubUserGlobalID,
				Blocked: targetGlobal.HubUserGlobalID,
			})
		}); err != nil {
			log.Error("CONSISTENCY_ALERT: failed to delete global block route after unblock", "error", err)
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// ListConnections handles POST /hub/connections/list
func ListConnections(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.ListConnectionsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		limit := int32(defaultConnectionListLimit)
		if req.Limit != nil && *req.Limit > 0 {
			limit = min(*req.Limit, maxConnectionListLimit)
		}

		params := regionaldb.ListMyConnectionsParams{
			Me:         hubUser.HubUserGlobalID,
			LimitCount: limit + 1,
		}
		if req.FilterQuery != nil && *req.FilterQuery != "" {
			params.FilterQuery = pgtype.Text{String: *req.FilterQuery, Valid: true}
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			if cursor, err := decodeConnectionCursor(*req.PaginationKey); err == nil {
				params.CursorConnectedAt = pgtype.Timestamptz{Time: cursor.Timestamp, Valid: true}
				params.CursorPeer = pgtype.UUID{Bytes: cursor.PeerUserID, Valid: true}
			}
		}

		rows, err := s.RegionalForCtx(ctx).ListMyConnections(ctx, params)
		if err != nil {
			log.Error("failed to list connections", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			last := rows[len(rows)-1]
			k := encodeConnectionCursor(last.ConnectedAt.Time, last.Peer)
			nextKey = &k
		}

		peerIDs := make([]pgtype.UUID, len(rows))
		for i, row := range rows {
			peerIDs[i] = row.Peer
		}
		peerProfiles := bulkResolvePeers(ctx, s, log, peerIDs)

		connections := make([]hubtypes.Connection, 0, len(rows))
		for _, row := range rows {
			prof, ok := peerProfiles[row.Peer.Bytes]
			if !ok {
				continue
			}
			conn := hubtypes.Connection{
				Handle:            hubtypes.Handle(prof.Handle),
				DisplayName:       prof.DisplayName,
				HasProfilePicture: prof.HasProfilePicture,
				ConnectedAt:       row.ConnectedAt.Time.UTC().Format(time.RFC3339),
			}
			if prof.ShortBio != "" {
				conn.ShortBio = &prof.ShortBio
			}
			if prof.ProfilePictureURL != "" {
				conn.ProfilePictureURL = &prof.ProfilePictureURL
			}
			connections = append(connections, conn)
		}

		json.NewEncoder(w).Encode(hubtypes.ListConnectionsResponse{
			Connections:       connections,
			NextPaginationKey: nextKey,
		})
	}
}

// ListIncomingRequests handles POST /hub/connections/list-incoming-requests
func ListIncomingRequests(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.ListPendingRequestsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		limit := int32(defaultConnectionListLimit)
		if req.Limit != nil && *req.Limit > 0 {
			limit = min(*req.Limit, maxConnectionListLimit)
		}

		params := regionaldb.ListIncomingPendingRequestsParams{
			Me:         hubUser.HubUserGlobalID,
			LimitCount: limit + 1,
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			if cursor, err := decodeConnectionCursor(*req.PaginationKey); err == nil {
				params.CursorCreatedAt = pgtype.Timestamptz{Time: cursor.Timestamp, Valid: true}
				params.CursorPeer = pgtype.UUID{Bytes: cursor.PeerUserID, Valid: true}
			}
		}

		rows, err := s.RegionalForCtx(ctx).ListIncomingPendingRequests(ctx, params)
		if err != nil {
			log.Error("failed to list incoming requests", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			last := rows[len(rows)-1]
			k := encodeConnectionCursor(last.CreatedAt.Time, last.Peer)
			nextKey = &k
		}

		peerIDs := make([]pgtype.UUID, len(rows))
		for i, row := range rows {
			peerIDs[i] = row.Peer
		}
		peerProfiles := bulkResolvePeers(ctx, s, log, peerIDs)

		incoming := make([]hubtypes.PendingRequest, 0, len(rows))
		for _, row := range rows {
			prof, ok := peerProfiles[row.Peer.Bytes]
			if !ok {
				continue
			}
			pr := hubtypes.PendingRequest{
				Handle:            hubtypes.Handle(prof.Handle),
				DisplayName:       prof.DisplayName,
				HasProfilePicture: prof.HasProfilePicture,
				CreatedAt:         row.CreatedAt.Time.UTC().Format(time.RFC3339),
			}
			if prof.ShortBio != "" {
				pr.ShortBio = &prof.ShortBio
			}
			if prof.ProfilePictureURL != "" {
				pr.ProfilePictureURL = &prof.ProfilePictureURL
			}
			incoming = append(incoming, pr)
		}

		json.NewEncoder(w).Encode(hubtypes.ListIncomingRequestsResponse{
			Incoming:          incoming,
			NextPaginationKey: nextKey,
		})
	}
}

// ListOutgoingRequests handles POST /hub/connections/list-outgoing-requests
func ListOutgoingRequests(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.ListPendingRequestsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		limit := int32(defaultConnectionListLimit)
		if req.Limit != nil && *req.Limit > 0 {
			limit = min(*req.Limit, maxConnectionListLimit)
		}

		params := regionaldb.ListOutgoingPendingRequestsParams{
			Me:         hubUser.HubUserGlobalID,
			LimitCount: limit + 1,
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			if cursor, err := decodeConnectionCursor(*req.PaginationKey); err == nil {
				params.CursorCreatedAt = pgtype.Timestamptz{Time: cursor.Timestamp, Valid: true}
				params.CursorPeer = pgtype.UUID{Bytes: cursor.PeerUserID, Valid: true}
			}
		}

		rows, err := s.RegionalForCtx(ctx).ListOutgoingPendingRequests(ctx, params)
		if err != nil {
			log.Error("failed to list outgoing requests", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			last := rows[len(rows)-1]
			k := encodeConnectionCursor(last.CreatedAt.Time, last.Peer)
			nextKey = &k
		}

		peerIDs := make([]pgtype.UUID, len(rows))
		for i, row := range rows {
			peerIDs[i] = row.Peer
		}
		peerProfiles := bulkResolvePeers(ctx, s, log, peerIDs)

		outgoing := make([]hubtypes.PendingRequest, 0, len(rows))
		for _, row := range rows {
			prof, ok := peerProfiles[row.Peer.Bytes]
			if !ok {
				continue
			}
			pr := hubtypes.PendingRequest{
				Handle:            hubtypes.Handle(prof.Handle),
				DisplayName:       prof.DisplayName,
				HasProfilePicture: prof.HasProfilePicture,
				CreatedAt:         row.CreatedAt.Time.UTC().Format(time.RFC3339),
			}
			if prof.ShortBio != "" {
				pr.ShortBio = &prof.ShortBio
			}
			if prof.ProfilePictureURL != "" {
				pr.ProfilePictureURL = &prof.ProfilePictureURL
			}
			outgoing = append(outgoing, pr)
		}

		json.NewEncoder(w).Encode(hubtypes.ListOutgoingRequestsResponse{
			Outgoing:          outgoing,
			NextPaginationKey: nextKey,
		})
	}
}

// ListBlocked handles POST /hub/connections/list-blocked
func ListBlocked(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.ListBlockedRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		limit := int32(defaultConnectionListLimit)
		if req.Limit != nil && *req.Limit > 0 {
			limit = min(*req.Limit, maxConnectionListLimit)
		}

		params := regionaldb.ListBlockedParams{
			Me:         hubUser.HubUserGlobalID,
			LimitCount: limit + 1,
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			if cursor, err := decodeConnectionCursor(*req.PaginationKey); err == nil {
				params.CursorBlockedAt = pgtype.Timestamptz{Time: cursor.Timestamp, Valid: true}
				params.CursorBlockedUserID = pgtype.UUID{Bytes: cursor.PeerUserID, Valid: true}
			}
		}

		rows, err := s.RegionalForCtx(ctx).ListBlocked(ctx, params)
		if err != nil {
			log.Error("failed to list blocked", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			last := rows[len(rows)-1]
			k := encodeConnectionCursor(last.BlockedAt.Time, last.BlockedUserID)
			nextKey = &k
		}

		peerIDs := make([]pgtype.UUID, len(rows))
		for i, row := range rows {
			peerIDs[i] = row.BlockedUserID
		}
		peerProfiles := bulkResolvePeers(ctx, s, log, peerIDs)

		blocked := make([]hubtypes.BlockedUser, 0, len(rows))
		for _, row := range rows {
			prof, ok := peerProfiles[row.BlockedUserID.Bytes]
			if !ok {
				continue
			}
			blocked = append(blocked, hubtypes.BlockedUser{
				Handle:      hubtypes.Handle(prof.Handle),
				DisplayName: prof.DisplayName,
				BlockedAt:   row.BlockedAt.Time.UTC().Format(time.RFC3339),
			})
		}

		json.NewEncoder(w).Encode(hubtypes.ListBlockedResponse{
			Blocked:           blocked,
			NextPaginationKey: nextKey,
		})
	}
}

// GetConnectionStatus handles POST /hub/connections/get-status
func GetConnectionStatus(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.GetStatusRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		targetGlobal, err := s.Global.GetHubUserByHandle(ctx, string(req.Handle))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to resolve handle", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if uuidEqual(hubUser.HubUserGlobalID, targetGlobal.HubUserGlobalID) {
			json.NewEncoder(w).Encode(hubtypes.GetStatusResponse{
				ConnectionState: hubtypes.ConnectionStateNotConnected,
			})
			return
		}

		// Block check via global
		blockRoutes, err := s.Global.GetBlockRoutes(ctx, globaldb.GetBlockRoutesParams{
			A: hubUser.HubUserGlobalID,
			B: targetGlobal.HubUserGlobalID,
		})
		if err != nil {
			log.Error("failed to get block routes", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		for _, br := range blockRoutes {
			if uuidEqual(br.BlockerUserID, hubUser.HubUserGlobalID) {
				json.NewEncoder(w).Encode(hubtypes.GetStatusResponse{
					ConnectionState: hubtypes.ConnectionStateIBlockedThem,
				})
				return
			}
			if uuidEqual(br.BlockerUserID, targetGlobal.HubUserGlobalID) {
				json.NewEncoder(w).Encode(hubtypes.GetStatusResponse{
					ConnectionState: hubtypes.ConnectionStateBlockedByThem,
				})
				return
			}
		}

		// Look up own edge (always in own home region)
		edge, err := s.RegionalForCtx(ctx).GetUserConnectionEdge(ctx, regionaldb.GetUserConnectionEdgeParams{
			Me:   hubUser.HubUserGlobalID,
			Peer: targetGlobal.HubUserGlobalID,
		})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to get own connection edge", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if errors.Is(err, pgx.ErrNoRows) {
			// No edge — check eligibility to determine if connection is possible
			callerStints, err := s.RegionalForCtx(ctx).GetUserEligibilityStints(ctx, hubUser.HubUserGlobalID)
			if err != nil {
				log.Error("failed to get caller stints for status", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			targetRegDB := s.GetRegionalDB(targetGlobal.HomeRegion)
			var targetStints []regionaldb.GetUserEligibilityStintsRow
			if targetRegDB != nil {
				targetStints, err = targetRegDB.GetUserEligibilityStints(ctx, targetGlobal.HubUserGlobalID)
				if err != nil {
					log.Error("failed to get target stints for status", "error", err)
					http.Error(w, "", http.StatusInternalServerError)
					return
				}
			}
			state := hubtypes.ConnectionStateIneligible
			if stintOverlaps(callerStints, targetStints) {
				state = hubtypes.ConnectionStateNotConnected
			}
			json.NewEncoder(w).Encode(hubtypes.GetStatusResponse{ConnectionState: state})
			return
		}

		// Map edge status to connection state
		var state hubtypes.ConnectionState
		switch edge.Status {
		case regionaldb.HubUserConnectionStatusOutgoingPending:
			state = hubtypes.ConnectionStateRequestSent
		case regionaldb.HubUserConnectionStatusIncomingPending:
			state = hubtypes.ConnectionStateRequestReceived
		case regionaldb.HubUserConnectionStatusConnected:
			state = hubtypes.ConnectionStateConnected
		case regionaldb.HubUserConnectionStatusTheyRejected:
			state = hubtypes.ConnectionStateTheyRejectedMyRequest
		case regionaldb.HubUserConnectionStatusIRejected:
			state = hubtypes.ConnectionStateIRejectedTheirRequest
		case regionaldb.HubUserConnectionStatusIDisconnected:
			state = hubtypes.ConnectionStateIDisconnected
		case regionaldb.HubUserConnectionStatusTheyDisconnected:
			state = hubtypes.ConnectionStateTheyDisconnected
		}

		json.NewEncoder(w).Encode(hubtypes.GetStatusResponse{ConnectionState: state})
	}
}

// SearchConnections handles POST /hub/connections/search
func SearchConnections(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.SearchConnectionsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		rows, err := s.RegionalForCtx(ctx).SearchConnectedByPrefix(ctx, regionaldb.SearchConnectedByPrefixParams{
			Me:     hubUser.HubUserGlobalID,
			Prefix: req.Query,
		})
		if err != nil {
			log.Error("failed to search connections", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		peerIDs := make([]pgtype.UUID, len(rows))
		for i, row := range rows {
			peerIDs[i] = row.Peer
		}
		peerProfiles := bulkResolvePeers(ctx, s, log, peerIDs)

		results := make([]hubtypes.Connection, 0, len(rows))
		for _, row := range rows {
			prof, ok := peerProfiles[row.Peer.Bytes]
			if !ok {
				continue
			}
			conn := hubtypes.Connection{
				Handle:            hubtypes.Handle(prof.Handle),
				DisplayName:       prof.DisplayName,
				HasProfilePicture: prof.HasProfilePicture,
				ConnectedAt:       row.ConnectedAt.Time.UTC().Format(time.RFC3339),
			}
			if prof.ShortBio != "" {
				conn.ShortBio = &prof.ShortBio
			}
			if prof.ProfilePictureURL != "" {
				conn.ProfilePictureURL = &prof.ProfilePictureURL
			}
			results = append(results, conn)
		}

		json.NewEncoder(w).Encode(hubtypes.SearchConnectionsResponse{Results: results})
	}
}

// GetConnectionCounts handles GET /hub/connections/counts
func GetConnectionCounts(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		counts, err := s.RegionalForCtx(ctx).GetConnectionCounts(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			log.Error("failed to get connection counts", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(hubtypes.ConnectionCounts{
			PendingIncoming: counts.PendingIncoming,
			PendingOutgoing: counts.PendingOutgoing,
			Connected:       counts.Connected,
			Blocked:         counts.Blocked,
		})
	}
}

// peerProfile holds resolved profile data for display in list responses.
type peerProfile struct {
	Handle            string
	DisplayName       string
	ShortBio          string
	HasProfilePicture bool
	ProfilePictureURL string
}

// bulkResolvePeers fetches display data for a set of peer IDs across all home regions.
// Returns a map from [16]byte UUID → peerProfile.
// Peers may live in different regional DBs; this function routes each lookup correctly.
func bulkResolvePeers(
	ctx context.Context,
	s *server.RegionalServer,
	log interface{ Error(string, ...any) },
	peerIDs []pgtype.UUID,
) map[[16]byte]peerProfile {
	if len(peerIDs) == 0 {
		return map[[16]byte]peerProfile{}
	}

	// One global call: get handle + home_region for all peers.
	globalUsers, err := s.Global.GetHubUsersByGlobalIDs(ctx, peerIDs)
	if err != nil {
		log.Error("failed to bulk fetch global hub users", "error", err)
		return map[[16]byte]peerProfile{}
	}

	// One global call: get preferred display names for all peers.
	displayNames, err := s.Global.GetHubUserPreferredDisplayNamesByIDs(ctx, peerIDs)
	if err != nil {
		log.Error("failed to bulk fetch display names", "error", err)
	}
	dnMap := make(map[[16]byte]string)
	for _, dn := range displayNames {
		dnMap[dn.HubUserGlobalID.Bytes] = dn.DisplayName
	}

	// Group peers by home region so we issue one regional call per region.
	regionGroups := make(map[globaldb.Region][]pgtype.UUID)
	for _, gu := range globalUsers {
		regionGroups[gu.HomeRegion] = append(regionGroups[gu.HomeRegion], gu.HubUserGlobalID)
	}

	// Fetch bio + profile picture from each peer's actual home regional DB.
	type bioAndPic struct {
		shortBio string
		picKey   pgtype.Text
		handle   string
	}
	regionalData := make(map[[16]byte]bioAndPic)
	for region, ids := range regionGroups {
		regionDB := s.GetRegionalDB(region)
		if regionDB == nil {
			log.Error("no regional DB for peer home region", "region", string(region))
			continue
		}
		profiles, err := regionDB.GetHubUserProfilesByGlobalIDs(ctx, ids)
		if err != nil {
			log.Error("failed to fetch regional peer profiles", "error", err, "region", string(region))
			continue
		}
		for _, p := range profiles {
			regionalData[p.HubUserGlobalID.Bytes] = bioAndPic{
				shortBio: p.ShortBio.String,
				picKey:   p.ProfilePictureStorageKey,
				handle:   p.Handle,
			}
		}
	}

	result := make(map[[16]byte]peerProfile)
	for _, gu := range globalUsers {
		displayName := gu.Handle
		if dn, ok := dnMap[gu.HubUserGlobalID.Bytes]; ok {
			displayName = dn
		}
		rd, ok := regionalData[gu.HubUserGlobalID.Bytes]
		if !ok {
			result[gu.HubUserGlobalID.Bytes] = peerProfile{
				Handle:      gu.Handle,
				DisplayName: displayName,
			}
			continue
		}
		pictureURL := ""
		if rd.picKey.Valid && rd.picKey.String != "" {
			pictureURL = fmt.Sprintf("/hub/profile-picture/%s", rd.handle)
		}
		result[gu.HubUserGlobalID.Bytes] = peerProfile{
			Handle:            gu.Handle,
			DisplayName:       displayName,
			ShortBio:          rd.shortBio,
			HasProfilePicture: rd.picKey.Valid && rd.picKey.String != "",
			ProfilePictureURL: pictureURL,
		}
	}
	return result
}
