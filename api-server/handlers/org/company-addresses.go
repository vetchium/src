package org

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/org"
)

const (
	defaultAddressLimit = 20
	maxAddressLimit     = 100
)

// CreateAddress handles POST /org/create-address
func CreateAddress(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.CreateAddressRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var addrLine2 pgtype.Text
		if req.AddressLine2 != nil {
			addrLine2 = pgtype.Text{String: *req.AddressLine2, Valid: true}
		}

		var state pgtype.Text
		if req.State != nil {
			state = pgtype.Text{String: *req.State, Valid: true}
		}

		var postalCode pgtype.Text
		if req.PostalCode != nil {
			postalCode = pgtype.Text{String: *req.PostalCode, Valid: true}
		}

		mapUrls := req.MapUrls
		if mapUrls == nil {
			mapUrls = []string{}
		}

		params := regionaldb.CreateOrgAddressParams{
			OrgID:        orgUser.OrgID,
			Title:        req.Title,
			AddressLine1: req.AddressLine1,
			AddressLine2: addrLine2,
			City:         req.City,
			State:        state,
			PostalCode:   postalCode,
			Country:      req.Country,
			MapUrls:      mapUrls,
		}

		var addr regionaldb.OrgAddress
		eventData, _ := json.Marshal(map[string]any{
			"address_id": addr.AddressID,
			"title":      req.Title,
		})
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			addr, txErr = qtx.CreateOrgAddress(ctx, params)
			if txErr != nil {
				return txErr
			}
			// Update event_data with the actual address_id after creation
			eventData, _ = json.Marshal(map[string]any{
				"address_id": addr.AddressID,
				"title":      req.Title,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.create_address",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to create address", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(dbAddressToResponse(addr))
	}
}

// UpdateAddress handles POST /org/update-address
func UpdateAddress(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.UpdateAddressRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var addrID pgtype.UUID
		if err := addrID.Scan(req.AddressID); err != nil {
			s.Logger(ctx).Debug("invalid address_id", "error", err)
			http.Error(w, "invalid address_id", http.StatusBadRequest)
			return
		}

		var addrLine2 pgtype.Text
		if req.AddressLine2 != nil {
			addrLine2 = pgtype.Text{String: *req.AddressLine2, Valid: true}
		}

		var state pgtype.Text
		if req.State != nil {
			state = pgtype.Text{String: *req.State, Valid: true}
		}

		var postalCode pgtype.Text
		if req.PostalCode != nil {
			postalCode = pgtype.Text{String: *req.PostalCode, Valid: true}
		}

		mapUrls := req.MapUrls
		if mapUrls == nil {
			mapUrls = []string{}
		}

		params := regionaldb.UpdateOrgAddressParams{
			AddressID:    addrID,
			OrgID:        orgUser.OrgID,
			Title:        req.Title,
			AddressLine1: req.AddressLine1,
			AddressLine2: addrLine2,
			City:         req.City,
			State:        state,
			PostalCode:   postalCode,
			Country:      req.Country,
			MapUrls:      mapUrls,
		}

		var addr regionaldb.OrgAddress
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			addr, txErr = qtx.UpdateOrgAddress(ctx, params)
			if txErr != nil {
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{
				"address_id": req.AddressID,
				"title":      req.Title,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.update_address",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to update address", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(dbAddressToResponse(addr))
	}
}

// DisableAddress handles POST /org/disable-address
func DisableAddress(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.DisableAddressRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var addrID pgtype.UUID
		if err := addrID.Scan(req.AddressID); err != nil {
			s.Logger(ctx).Debug("invalid address_id", "error", err)
			http.Error(w, "invalid address_id", http.StatusBadRequest)
			return
		}

		var addr regionaldb.OrgAddress
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			addr, txErr = qtx.DisableOrgAddress(ctx, regionaldb.DisableOrgAddressParams{
				AddressID: addrID,
				OrgID:     orgUser.OrgID,
			})
			if txErr != nil {
				if errors.Is(txErr, pgx.ErrNoRows) {
					// Check if address exists at all
					existing, getErr := qtx.GetOrgAddress(ctx, regionaldb.GetOrgAddressParams{
						AddressID: addrID,
						OrgID:     orgUser.OrgID,
					})
					if getErr != nil {
						if errors.Is(getErr, pgx.ErrNoRows) {
							return server.ErrNotFound
						}
						return getErr
					}
					// Address exists but wasn't disabled (probably already disabled)
					if existing.Status == "disabled" {
						return server.ErrInvalidState
					}
					return server.ErrInvalidState
				}
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{
				"address_id": req.AddressID,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.disable_address",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, server.ErrNotFound) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if errors.Is(err, server.ErrInvalidState) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			s.Logger(ctx).Error("failed to disable address", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(dbAddressToResponse(addr))
	}
}

// EnableAddress handles POST /org/enable-address
func EnableAddress(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.EnableAddressRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var addrID pgtype.UUID
		if err := addrID.Scan(req.AddressID); err != nil {
			s.Logger(ctx).Debug("invalid address_id", "error", err)
			http.Error(w, "invalid address_id", http.StatusBadRequest)
			return
		}

		var addr regionaldb.OrgAddress
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			addr, txErr = qtx.EnableOrgAddress(ctx, regionaldb.EnableOrgAddressParams{
				AddressID: addrID,
				OrgID:     orgUser.OrgID,
			})
			if txErr != nil {
				if errors.Is(txErr, pgx.ErrNoRows) {
					// Check if address exists at all
					existing, getErr := qtx.GetOrgAddress(ctx, regionaldb.GetOrgAddressParams{
						AddressID: addrID,
						OrgID:     orgUser.OrgID,
					})
					if getErr != nil {
						if errors.Is(getErr, pgx.ErrNoRows) {
							return server.ErrNotFound
						}
						return getErr
					}
					// Address exists but wasn't enabled (probably already active)
					if existing.Status == "active" {
						return server.ErrInvalidState
					}
					return server.ErrInvalidState
				}
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{
				"address_id": req.AddressID,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.enable_address",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, server.ErrNotFound) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if errors.Is(err, server.ErrInvalidState) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			s.Logger(ctx).Error("failed to enable address", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(dbAddressToResponse(addr))
	}
}

// GetAddress handles POST /org/get-address
func GetAddress(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.GetAddressRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var addrID pgtype.UUID
		if err := addrID.Scan(req.AddressID); err != nil {
			s.Logger(ctx).Debug("invalid address_id", "error", err)
			http.Error(w, "invalid address_id", http.StatusBadRequest)
			return
		}

		addr, err := s.RegionalForCtx(ctx).GetOrgAddress(ctx, regionaldb.GetOrgAddressParams{
			AddressID: addrID,
			OrgID:     orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get address", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(dbAddressToResponse(addr))
	}
}

// ListAddresses handles POST /org/list-addresses
func ListAddresses(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.ListAddressesRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		limit := defaultAddressLimit
		if req.Limit != nil {
			limit = int(*req.Limit)
			if limit > maxAddressLimit {
				limit = maxAddressLimit
			}
		}

		var cursorCreatedAt pgtype.Timestamp
		var cursorID pgtype.UUID

		if req.PaginationKey != nil && *req.PaginationKey != "" {
			ca, id, err := decodeAddressCursor(*req.PaginationKey)
			if err != nil {
				s.Logger(ctx).Debug("invalid cursor", "error", err)
				http.Error(w, "invalid cursor format", http.StatusBadRequest)
				return
			}
			cursorCreatedAt = pgtype.Timestamp{Time: ca, Valid: true}
			if err := cursorID.Scan(id); err != nil {
				s.Logger(ctx).Debug("invalid cursor id", "error", err)
				http.Error(w, "invalid cursor format", http.StatusBadRequest)
				return
			}
		}

		var filterStatus regionaldb.NullOrgAddressStatus
		if req.FilterStatus != nil {
			filterStatus = regionaldb.NullOrgAddressStatus{
				OrgAddressStatus: regionaldb.OrgAddressStatus(*req.FilterStatus),
				Valid:            true,
			}
		}

		params := regionaldb.ListOrgAddressesParams{
			OrgID:           orgUser.OrgID,
			FilterStatus:    filterStatus,
			CursorCreatedAt: cursorCreatedAt,
			CursorID:        cursorID,
			LimitCount:      int32(limit + 1),
		}

		addresses, err := s.RegionalForCtx(ctx).ListOrgAddresses(ctx, params)
		if err != nil {
			s.Logger(ctx).Error("failed to list addresses", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(addresses) > limit
		if hasMore {
			addresses = addresses[:limit]
		}

		items := make([]org.OrgAddress, 0, len(addresses))
		for _, addr := range addresses {
			items = append(items, dbAddressToResponse(addr))
		}

		var nextCursor string
		if hasMore && len(addresses) > 0 {
			last := addresses[len(addresses)-1]
			if last.CreatedAt.Valid {
				nextCursor = encodeAddressCursor(last.CreatedAt.Time, last.AddressID)
			}
		}

		response := org.ListAddressesResponse{
			Addresses:         items,
			NextPaginationKey: nextCursor,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("failed to encode response", "error", err)
		}
	}
}

func dbAddressToResponse(addr regionaldb.OrgAddress) org.OrgAddress {
	resp := org.OrgAddress{
		AddressID:    addr.AddressID.String(),
		Title:        addr.Title,
		AddressLine1: addr.AddressLine1,
		City:         addr.City,
		Country:      addr.Country,
		Status:       org.OrgAddressStatus(addr.Status),
		CreatedAt:    addr.CreatedAt.Time.UTC().Format(time.RFC3339),
		MapUrls:      addr.MapUrls,
	}
	if resp.MapUrls == nil {
		resp.MapUrls = []string{}
	}
	if addr.AddressLine2.Valid {
		resp.AddressLine2 = &addr.AddressLine2.String
	}
	if addr.State.Valid {
		resp.State = &addr.State.String
	}
	if addr.PostalCode.Valid {
		resp.PostalCode = &addr.PostalCode.String
	}
	return resp
}

func encodeAddressCursor(createdAt time.Time, id pgtype.UUID) string {
	idBytes := id.Bytes
	idStr := fmt.Sprintf("%x-%x-%x-%x-%x", idBytes[0:4], idBytes[4:6], idBytes[6:8], idBytes[8:10], idBytes[10:16])
	data := fmt.Sprintf("%s|%s", createdAt.UTC().Format(time.RFC3339Nano), idStr)
	return base64.URLEncoding.EncodeToString([]byte(data))
}

func decodeAddressCursor(cursor string) (time.Time, string, error) {
	data, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, "", err
	}
	parts := strings.Split(string(data), "|")
	if len(parts) != 2 {
		return time.Time{}, "", fmt.Errorf("invalid cursor format")
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, "", err
	}
	return t, parts[1], nil
}
