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
	"vetchium-api-server.gomodule/internal/proxy"
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
	out := make([]byte, 32)
	for i, b := range h {
		out[i] = b
	}
	return fmt.Sprintf("%x", h)
}

// uuidEqual compares two pgtype.UUIDs for equality.
func uuidEqual(a, b pgtype.UUID) bool {
	return a.Valid && b.Valid && a.Bytes == b.Bytes
}

// stintOverlaps checks if any of A's stints overlaps with any of B's stints on a shared domain.
// Each stint has (domain, first_verified_at, last_verified_at, ended_at, status).
func stintOverlaps(
	aStints []regionaldb.GetUserEligibilityStintsRow,
	bStints []regionaldb.GetUserEligibilityStintsRow,
) bool {
	// Build a map from domain → stints for B
	bByDomain := make(map[string][]regionaldb.GetUserEligibilityStintsRow)
	for _, s := range bStints {
		bByDomain[s.Domain] = append(bByDomain[s.Domain], s)
	}

	for _, a := range aStints {
		bs, ok := bByDomain[a.Domain]
		if !ok {
			continue
		}
		// aEnd: if active, use current time (still ongoing); if ended, use ended_at or last_verified_at
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
			// Overlap: a.start <= b.end AND b.start <= a.end
			if !aStart.After(bEnd) && !bStart.After(aEnd) {
				return true
			}
		}
	}
	return false
}

// getPreferredDisplayName picks the best display name for a peer.
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

// resolveHandleToGlobalUser looks up a hub user by handle in the global DB.
// Returns the user and nil error on success, pgx.ErrNoRows if not found.
func resolveHandleToGlobalUser(s *server.RegionalServer, r *http.Request, handle string) (globaldb.HubUser, error) {
	return s.Global.GetHubUserByHandle(r.Context(), handle)
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
	// format: "RFC3339Nano|hex16bytes"
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
	for i := 0; i < 16; i++ {
		var b byte
		fmt.Sscanf(hexStr[i*2:i*2+2], "%02x", &b)
		id[i] = b
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

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
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

		// Step 2: Resolve target via global DB
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

		// Step 3: Self-check
		if uuidEqual(hubUser.HubUserGlobalID, targetGlobal.HubUserGlobalID) {
			w.WriteHeader(httpStatusSelf)
			return
		}

		// Step 4: Block check via global routing table (single global query)
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
				// Caller blocked target
				w.WriteHeader(httpStatusCallerBlocked)
				return
			}
			if uuidEqual(br.BlockerUserID, targetGlobal.HubUserGlobalID) {
				// Target blocked caller
				w.WriteHeader(httpStatusTargetBlocked)
				return
			}
		}

		// Step 5: Eligibility check (cross-region stints)
		callerRegDB := s.Regional
		callerStints, err := callerRegDB.GetUserEligibilityStints(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			log.Error("failed to get caller stints", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var targetStints []regionaldb.GetUserEligibilityStintsRow
		if targetGlobal.HomeRegion == s.CurrentRegion {
			targetStints, err = s.Regional.GetUserEligibilityStints(ctx, targetGlobal.HubUserGlobalID)
			if err != nil {
				log.Error("failed to get target stints (same region)", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
		} else {
			targetRegDB := s.GetRegionalDB(targetGlobal.HomeRegion)
			if targetRegDB == nil {
				// Fall back to proxy if we can't access target's region directly
				s.ProxyToRegion(w, r, targetGlobal.HomeRegion, bodyBytes)
				return
			}
			targetStints, err = targetRegDB.GetUserEligibilityStints(ctx, targetGlobal.HubUserGlobalID)
			if err != nil {
				log.Error("failed to get target stints (remote region)", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
		}

		if !stintOverlaps(callerStints, targetStints) {
			w.WriteHeader(httpStatusIneligible)
			return
		}

		// Step 6: State precondition check
		pair, err := s.Regional.GetConnectionPair(ctx, regionaldb.GetConnectionPairParams{
			A: hubUser.HubUserGlobalID,
			B: targetGlobal.HubUserGlobalID,
		})
		var pairExists bool
		var pairToDelete bool
		if err == nil {
			pairExists = true
			switch pair.Status {
			case regionaldb.HubConnectionStatusPending, regionaldb.HubConnectionStatusConnected:
				w.WriteHeader(httpStatusStateConflict)
				return
			case regionaldb.HubConnectionStatusRejected:
				if uuidEqual(pair.RequesterUserID, hubUser.HubUserGlobalID) {
					// Caller was previously rejected by target — cannot re-request
					w.WriteHeader(httpStatusRequesterBarred)
					return
				}
				// Caller previously rejected target → caller may now send fresh request
				pairToDelete = true
			case regionaldb.HubConnectionStatusDisconnected:
				if uuidEqual(pair.DisconnectorUserID, targetGlobal.HubUserGlobalID) {
					// Target disconnected from caller — cannot re-request
					w.WriteHeader(httpStatusDisconnectedBarred)
					return
				}
				// Caller disconnected → may re-request; delete old row
				pairToDelete = true
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to get connection pair", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Step 7: Write
		peerIDHash := hashUserID(targetGlobal.HubUserGlobalID)
		auditData, _ := json.Marshal(map[string]any{"peer_user_id_hash": peerIDHash})

		// Get target's display name for email
		targetDisplayNames, err := s.Global.ListHubUserDisplayNames(ctx, targetGlobal.HubUserGlobalID)
		if err != nil {
			log.Error("failed to get target display names", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
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

		// Get target's email from regional DB (need to find target in regional)
		var targetEmail string
		if targetGlobal.HomeRegion == s.CurrentRegion {
			targetUser, err := s.Regional.GetHubUserByGlobalID(ctx, targetGlobal.HubUserGlobalID)
			if err == nil {
				targetEmail = targetUser.EmailAddress
			}
		} else {
			targetRegDB := s.GetRegionalDB(targetGlobal.HomeRegion)
			if targetRegDB != nil {
				targetUser, err := targetRegDB.GetHubUserByGlobalID(ctx, targetGlobal.HubUserGlobalID)
				if err == nil {
					targetEmail = targetUser.EmailAddress
				}
			}
		}

		// Cross-DB write: global first (upsert pair route), then regional
		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.UpsertConnectionPairRoute(ctx, globaldb.UpsertConnectionPairRouteParams{
				A:      hubUser.HubUserGlobalID,
				B:      targetGlobal.HubUserGlobalID,
				Region: string(s.CurrentRegion),
			})
		})
		if err != nil {
			log.Error("failed to upsert global connection pair route", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		_ = pairExists
		regionalErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if pairToDelete {
				if err := qtx.DeletePriorConnectionRow(ctx, regionaldb.DeletePriorConnectionRowParams{
					A: hubUser.HubUserGlobalID,
					B: targetGlobal.HubUserGlobalID,
				}); err != nil {
					return err
				}
			}

			if _, err := qtx.InsertPendingConnection(ctx, regionaldb.InsertPendingConnectionParams{
				Requester: hubUser.HubUserGlobalID,
				Recipient: targetGlobal.HubUserGlobalID,
			}); err != nil {
				return err
			}

			// Enqueue notification email to target if we have their email
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
		if regionalErr != nil {
			// Compensate global route
			compErr := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
				return qtx.DeleteConnectionPairRoute(ctx, globaldb.DeleteConnectionPairRouteParams{
					A: hubUser.HubUserGlobalID,
					B: targetGlobal.HubUserGlobalID,
				})
			})
			if compErr != nil {
				log.Error("CONSISTENCY_ALERT: failed to compensate global connection pair route",
					"error", compErr, "original_error", regionalErr)
			}
			log.Error("failed regional tx for send-connection-request", "error", regionalErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		_ = targetDisplayNames
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

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
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

		// Resolve peer handle → global ID
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

		// Find where the pair is stored
		pairRoute, err := s.Global.GetConnectionPairRoute(ctx, globaldb.GetConnectionPairRouteParams{
			A: hubUser.HubUserGlobalID,
			B: peerGlobal.HubUserGlobalID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get pair route", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Proxy to pair's region if different
		if pairRoute.Region != string(s.CurrentRegion) {
			s.ProxyToRegion(w, r, globaldb.Region(pairRoute.Region), bodyBytes)
			return
		}

		// Get peer's email for notification
		var peerEmail string
		peerUser, err := s.Regional.GetHubUserByGlobalID(ctx, peerGlobal.HubUserGlobalID)
		if err == nil {
			peerEmail = peerUser.EmailAddress
		}

		// Get caller's display name for email
		callerDisplayNames, _ := s.Global.ListHubUserDisplayNames(ctx, hubUser.HubUserGlobalID)
		callerName := getPreferredDisplayName(callerDisplayNames)
		if callerName == "" {
			callerName = string(hubUser.Handle)
		}

		peerIDHash := hashUserID(peerGlobal.HubUserGlobalID)

		var connectedAt time.Time
		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			conn, err := qtx.AcceptPendingConnection(ctx, regionaldb.AcceptPendingConnectionParams{
				A:     hubUser.HubUserGlobalID,
				B:     peerGlobal.HubUserGlobalID,
				Actor: hubUser.HubUserGlobalID,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return errNotFound
				}
				return err
			}
			connectedAt = conn.ConnectedAt.Time

			// Enqueue email to original requester (peer in this context)
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

			auditData, _ := json.Marshal(map[string]any{
				"peer_user_id_hash": peerIDHash,
				"connected_at":      connectedAt.UTC().Format(time.RFC3339),
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.accept_connection_request",
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
			log.Error("failed to accept connection request", "error", txErr)
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

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
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

		// Find pair's region
		pairRoute, err := s.Global.GetConnectionPairRoute(ctx, globaldb.GetConnectionPairRouteParams{
			A: hubUser.HubUserGlobalID,
			B: peerGlobal.HubUserGlobalID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get pair route", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if pairRoute.Region != string(s.CurrentRegion) {
			s.ProxyToRegion(w, r, globaldb.Region(pairRoute.Region), bodyBytes)
			return
		}

		peerIDHash := hashUserID(peerGlobal.HubUserGlobalID)
		auditData, _ := json.Marshal(map[string]any{"peer_user_id_hash": peerIDHash})

		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			_, err := qtx.RejectPendingConnection(ctx, regionaldb.RejectPendingConnectionParams{
				A:     hubUser.HubUserGlobalID,
				B:     peerGlobal.HubUserGlobalID,
				Actor: hubUser.HubUserGlobalID,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return errNotFound
				}
				return err
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.reject_connection_request",
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
			log.Error("failed to reject connection request", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{})
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

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
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

		// Find pair's region
		pairRoute, err := s.Global.GetConnectionPairRoute(ctx, globaldb.GetConnectionPairRouteParams{
			A: hubUser.HubUserGlobalID,
			B: peerGlobal.HubUserGlobalID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get pair route", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if pairRoute.Region != string(s.CurrentRegion) {
			s.ProxyToRegion(w, r, globaldb.Region(pairRoute.Region), bodyBytes)
			return
		}

		peerIDHash := hashUserID(peerGlobal.HubUserGlobalID)
		auditData, _ := json.Marshal(map[string]any{"peer_user_id_hash": peerIDHash})

		var rowsDeleted int64
		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			rows, err := qtx.WithdrawPendingConnection(ctx, regionaldb.WithdrawPendingConnectionParams{
				A:     hubUser.HubUserGlobalID,
				B:     peerGlobal.HubUserGlobalID,
				Actor: hubUser.HubUserGlobalID,
			})
			if err != nil {
				return err
			}
			rowsDeleted = rows
			if rows == 0 {
				return nil // will check after tx
			}

			if err := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.withdraw_connection_request",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			}); err != nil {
				return err
			}
			return nil
		})
		if txErr != nil {
			log.Error("failed to withdraw connection request", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if rowsDeleted == 0 {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Delete global pair route since row is gone
		if err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.DeleteConnectionPairRoute(ctx, globaldb.DeleteConnectionPairRouteParams{
				A: hubUser.HubUserGlobalID,
				B: peerGlobal.HubUserGlobalID,
			})
		}); err != nil {
			log.Error("CONSISTENCY_ALERT: failed to delete global connection pair route after withdraw",
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

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
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

		pairRoute, err := s.Global.GetConnectionPairRoute(ctx, globaldb.GetConnectionPairRouteParams{
			A: hubUser.HubUserGlobalID,
			B: peerGlobal.HubUserGlobalID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get pair route", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if pairRoute.Region != string(s.CurrentRegion) {
			s.ProxyToRegion(w, r, globaldb.Region(pairRoute.Region), bodyBytes)
			return
		}

		peerIDHash := hashUserID(peerGlobal.HubUserGlobalID)
		auditData, _ := json.Marshal(map[string]any{"peer_user_id_hash": peerIDHash})

		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			_, err := qtx.DisconnectConnection(ctx, regionaldb.DisconnectConnectionParams{
				A:     hubUser.HubUserGlobalID,
				B:     peerGlobal.HubUserGlobalID,
				Actor: hubUser.HubUserGlobalID,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return errNotFound
				}
				return err
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

		json.NewEncoder(w).Encode(map[string]any{})
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

		// Write block to global first, then regional
		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.UpsertBlockRoute(ctx, globaldb.UpsertBlockRouteParams{
				Blocker: hubUser.HubUserGlobalID,
				Blocked: targetGlobal.HubUserGlobalID,
				Region:  string(s.CurrentRegion),
			})
		})
		if err != nil {
			log.Error("failed to upsert block route", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

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
				// ON CONFLICT DO NOTHING returned no rows → already blocked
				alreadyBlocked = true
				return nil
			}

			// Sever any existing connection
			if err := qtx.SeverConnectionForBlock(ctx, regionaldb.SeverConnectionForBlockParams{
				A:       hubUser.HubUserGlobalID,
				B:       targetGlobal.HubUserGlobalID,
				Blocker: hubUser.HubUserGlobalID,
			}); err != nil {
				return err
			}

			// Delete any pending request
			if err := qtx.DeletePendingForBlock(ctx, regionaldb.DeletePendingForBlockParams{
				A: hubUser.HubUserGlobalID,
				B: targetGlobal.HubUserGlobalID,
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
			// Clean up global route we just inserted (it was a conflict-no-op but we upserted)
			// Actually UpsertBlockRoute is ON CONFLICT DO NOTHING so global is fine
			w.WriteHeader(httpStatusAlreadyBlocked)
			return
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
				w.WriteHeader(httpStatusNotBlocked) // spec says 459 not 404 for unblock
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

		// Delete global block route
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
			limit = *req.Limit
			if limit > maxConnectionListLimit {
				limit = maxConnectionListLimit
			}
		}

		params := regionaldb.ListMyConnectionsParams{
			Me:         hubUser.HubUserGlobalID,
			LimitCount: limit + 1,
		}
		if req.FilterQuery != nil && *req.FilterQuery != "" {
			params.FilterQuery = pgtype.Text{String: *req.FilterQuery, Valid: true}
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			cursor, err := decodeConnectionCursor(*req.PaginationKey)
			if err == nil {
				params.CursorConnectedAt = pgtype.Timestamptz{Time: cursor.Timestamp, Valid: true}
				params.CursorPeerUserID = pgtype.UUID{Bytes: cursor.PeerUserID, Valid: true}
			}
		}

		rows, err := s.Regional.ListMyConnections(ctx, params)
		if err != nil {
			log.Error("failed to list connections", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			last := rows[len(rows)-1]
			var lastPeerID pgtype.UUID
			if peerID, ok := uuidFromInterface(last.PeerUserID); ok {
				lastPeerID = peerID
			}
			k := encodeConnectionCursor(last.ConnectedAt.Time, lastPeerID)
			nextKey = &k
		}

		// Bulk resolve peer profile data
		peerIDs := make([]pgtype.UUID, 0, len(rows))
		for _, row := range rows {
			if peerID, ok := uuidFromInterface(row.PeerUserID); ok {
				peerIDs = append(peerIDs, peerID)
			}
		}
		peerProfiles := bulkResolvePeers(ctx, s, log, peerIDs)

		connections := make([]hubtypes.Connection, 0, len(rows))
		for _, row := range rows {
			peerIDFace, ok := uuidFromInterface(row.PeerUserID)
			if !ok {
				continue
			}
			prof, ok := peerProfiles[peerIDFace.Bytes]
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
			limit = *req.Limit
			if limit > maxConnectionListLimit {
				limit = maxConnectionListLimit
			}
		}

		params := regionaldb.ListIncomingPendingRequestsParams{
			Me:         hubUser.HubUserGlobalID,
			LimitCount: limit + 1,
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			cursor, err := decodeConnectionCursor(*req.PaginationKey)
			if err == nil {
				params.CursorCreatedAt = pgtype.Timestamptz{Time: cursor.Timestamp, Valid: true}
				params.CursorPeerUserID = pgtype.UUID{Bytes: cursor.PeerUserID, Valid: true}
			}
		}

		rows, err := s.Regional.ListIncomingPendingRequests(ctx, params)
		if err != nil {
			log.Error("failed to list incoming requests", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			last := rows[len(rows)-1]
			k := encodeConnectionCursor(last.CreatedAt.Time, last.PeerUserID)
			nextKey = &k
		}

		peerIDs := make([]pgtype.UUID, 0, len(rows))
		for _, row := range rows {
			peerIDs = append(peerIDs, row.PeerUserID)
		}
		peerProfiles := bulkResolvePeers(ctx, s, log, peerIDs)

		incoming := make([]hubtypes.PendingRequest, 0, len(rows))
		for _, row := range rows {
			prof, ok := peerProfiles[row.PeerUserID.Bytes]
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
			limit = *req.Limit
			if limit > maxConnectionListLimit {
				limit = maxConnectionListLimit
			}
		}

		params := regionaldb.ListOutgoingPendingRequestsParams{
			Me:         hubUser.HubUserGlobalID,
			LimitCount: limit + 1,
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			cursor, err := decodeConnectionCursor(*req.PaginationKey)
			if err == nil {
				params.CursorCreatedAt = pgtype.Timestamptz{Time: cursor.Timestamp, Valid: true}
				params.CursorPeerUserID = pgtype.UUID{Bytes: cursor.PeerUserID, Valid: true}
			}
		}

		rows, err := s.Regional.ListOutgoingPendingRequests(ctx, params)
		if err != nil {
			log.Error("failed to list outgoing requests", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			last := rows[len(rows)-1]
			var lastPeerID pgtype.UUID
			if peerID, ok := uuidFromInterface(last.PeerUserID); ok {
				lastPeerID = peerID
			}
			k := encodeConnectionCursor(last.CreatedAt.Time, lastPeerID)
			nextKey = &k
		}

		peerIDs := make([]pgtype.UUID, 0, len(rows))
		for _, row := range rows {
			if peerID, ok := uuidFromInterface(row.PeerUserID); ok {
				peerIDs = append(peerIDs, peerID)
			}
		}
		peerProfiles := bulkResolvePeers(ctx, s, log, peerIDs)

		outgoing := make([]hubtypes.PendingRequest, 0, len(rows))
		for _, row := range rows {
			peerIDFace, ok := uuidFromInterface(row.PeerUserID)
			if !ok {
				continue
			}
			prof, ok := peerProfiles[peerIDFace.Bytes]
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
			limit = *req.Limit
			if limit > maxConnectionListLimit {
				limit = maxConnectionListLimit
			}
		}

		params := regionaldb.ListBlockedParams{
			Me:         hubUser.HubUserGlobalID,
			LimitCount: limit + 1,
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			cursor, err := decodeConnectionCursor(*req.PaginationKey)
			if err == nil {
				params.CursorBlockedAt = pgtype.Timestamptz{Time: cursor.Timestamp, Valid: true}
				params.CursorBlockedUserID = pgtype.UUID{Bytes: cursor.PeerUserID, Valid: true}
			}
		}

		rows, err := s.Regional.ListBlocked(ctx, params)
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

		peerIDs := make([]pgtype.UUID, 0, len(rows))
		for _, row := range rows {
			peerIDs = append(peerIDs, row.BlockedUserID)
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

		// Self
		if uuidEqual(hubUser.HubUserGlobalID, targetGlobal.HubUserGlobalID) {
			json.NewEncoder(w).Encode(hubtypes.GetStatusResponse{
				ConnectionState: hubtypes.ConnectionStateNotConnected,
			})
			return
		}

		// Step 2: Block check via global
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

		// Step 3: Connection pair check
		// First check if the pair route exists (to find the right region)
		pairRoute, err := s.Global.GetConnectionPairRoute(ctx, globaldb.GetConnectionPairRouteParams{
			A: hubUser.HubUserGlobalID,
			B: targetGlobal.HubUserGlobalID,
		})

		var pairRegDB *regionaldb.Queries
		if err == nil {
			if pairRoute.Region == string(s.CurrentRegion) {
				pairRegDB = s.Regional
			} else {
				pairRegDB = s.GetRegionalDB(globaldb.Region(pairRoute.Region))
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to get pair route for status check", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var pair regionaldb.HubConnection
		var pairFound bool
		if pairRegDB != nil {
			pair, err = pairRegDB.GetConnectionPair(ctx, regionaldb.GetConnectionPairParams{
				A: hubUser.HubUserGlobalID,
				B: targetGlobal.HubUserGlobalID,
			})
			if err == nil {
				pairFound = true
			} else if !errors.Is(err, pgx.ErrNoRows) {
				log.Error("failed to get connection pair for status", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
		}

		if !pairFound {
			// No pair — check eligibility
			callerStints, err := s.Regional.GetUserEligibilityStints(ctx, hubUser.HubUserGlobalID)
			if err != nil {
				log.Error("failed to get caller stints for status", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			var targetStints []regionaldb.GetUserEligibilityStintsRow
			if targetGlobal.HomeRegion == s.CurrentRegion {
				targetStints, err = s.Regional.GetUserEligibilityStints(ctx, targetGlobal.HubUserGlobalID)
			} else {
				targetRegDB := s.GetRegionalDB(targetGlobal.HomeRegion)
				if targetRegDB != nil {
					targetStints, err = targetRegDB.GetUserEligibilityStints(ctx, targetGlobal.HubUserGlobalID)
				}
			}
			if err != nil {
				log.Error("failed to get target stints for status", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			state := hubtypes.ConnectionStateIneligible
			if stintOverlaps(callerStints, targetStints) {
				state = hubtypes.ConnectionStateNotConnected
			}
			json.NewEncoder(w).Encode(hubtypes.GetStatusResponse{ConnectionState: state})
			return
		}

		// Determine state from pair
		var state hubtypes.ConnectionState
		switch pair.Status {
		case regionaldb.HubConnectionStatusPending:
			if uuidEqual(pair.RequesterUserID, hubUser.HubUserGlobalID) {
				state = hubtypes.ConnectionStateRequestSent
			} else {
				state = hubtypes.ConnectionStateRequestReceived
			}
		case regionaldb.HubConnectionStatusConnected:
			state = hubtypes.ConnectionStateConnected
		case regionaldb.HubConnectionStatusRejected:
			if uuidEqual(pair.RejecterUserID, hubUser.HubUserGlobalID) {
				state = hubtypes.ConnectionStateIRejectedTheirRequest
			} else {
				state = hubtypes.ConnectionStateTheyRejectedMyRequest
			}
		case regionaldb.HubConnectionStatusDisconnected:
			if uuidEqual(pair.DisconnectorUserID, hubUser.HubUserGlobalID) {
				state = hubtypes.ConnectionStateIDisconnected
			} else {
				state = hubtypes.ConnectionStateTheyDisconnected
			}
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

		rows, err := s.Regional.SearchConnectedByPrefix(ctx, regionaldb.SearchConnectedByPrefixParams{
			Me:     hubUser.HubUserGlobalID,
			Prefix: req.Query,
		})
		if err != nil {
			log.Error("failed to search connections", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		peerIDs := make([]pgtype.UUID, 0, len(rows))
		for _, row := range rows {
			if peerID, ok := uuidFromInterface(row.PeerUserID); ok {
				peerIDs = append(peerIDs, peerID)
			}
		}
		peerProfiles := bulkResolvePeers(ctx, s, log, peerIDs)

		results := make([]hubtypes.Connection, 0, len(rows))
		for _, row := range rows {
			peerIDFace, ok := uuidFromInterface(row.PeerUserID)
			if !ok {
				continue
			}
			prof, ok := peerProfiles[peerIDFace.Bytes]
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

		counts, err := s.Regional.GetConnectionCounts(ctx, hubUser.HubUserGlobalID)
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

// uuidFromInterface extracts a pgtype.UUID from an interface{} value.
func uuidFromInterface(v interface{}) (pgtype.UUID, bool) {
	if v == nil {
		return pgtype.UUID{}, false
	}
	switch val := v.(type) {
	case pgtype.UUID:
		return val, val.Valid
	case [16]byte:
		return pgtype.UUID{Bytes: val, Valid: true}, true
	case []byte:
		if len(val) == 16 {
			var arr [16]byte
			copy(arr[:], val)
			return pgtype.UUID{Bytes: arr, Valid: true}, true
		}
	}
	return pgtype.UUID{}, false
}

// bulkResolvePeers fetches hub_users rows and display names for a set of peer IDs.
// Returns a map from [16]byte UUID → peerProfile.
func bulkResolvePeers(
	ctx context.Context,
	s *server.RegionalServer,
	log interface{ Error(string, ...interface{}) },
	peerIDs []pgtype.UUID,
) map[[16]byte]peerProfile {
	if len(peerIDs) == 0 {
		return map[[16]byte]peerProfile{}
	}

	// Fetch hub_users from regional DB
	hubUsers := make(map[[16]byte]regionaldb.HubUser)
	for _, id := range peerIDs {
		user, err := s.Regional.GetHubUserByGlobalID(ctx, id)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			// Log but don't fail the entire bulk operation
			log.Error("failed to get hub user", "error", err)
			continue
		}
		hubUsers[id.Bytes] = user
	}

	// Fetch display names from global DB
	displayNameMap := make(map[[16]byte]globaldb.HubUserDisplayName)
	for _, id := range peerIDs {
		names, err := s.Global.ListHubUserDisplayNames(ctx, id)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			log.Error("failed to get display names", "error", err)
			continue
		}
		if len(names) > 0 {
			// Take the first (preferred) display name
			displayNameMap[id.Bytes] = names[0]
		}
	}

	// Build result map
	result := make(map[[16]byte]peerProfile)
	for _, id := range peerIDs {
		user, ok := hubUsers[id.Bytes]
		if !ok {
			continue
		}

		displayName := user.Handle
		if dn, ok := displayNameMap[id.Bytes]; ok {
			displayName = dn.DisplayName
		}

		pictureURL := ""
		if user.ProfilePictureStorageKey.Valid && user.ProfilePictureStorageKey.String != "" {
			pictureURL = fmt.Sprintf("/hub/profile-picture/%s", user.Handle)
		}

		result[id.Bytes] = peerProfile{
			Handle:            user.Handle,
			DisplayName:       displayName,
			ShortBio:          user.ShortBio.String,
			HasProfilePicture: user.ProfilePictureStorageKey.Valid && user.ProfilePictureStorageKey.String != "",
			ProfilePictureURL: pictureURL,
		}
	}

	return result
}
