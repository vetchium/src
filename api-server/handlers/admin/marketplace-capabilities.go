package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	admintypes "vetchium-api-server.typespec/admin"
)

const defaultAdminCapabilityLimit = 50
const maxAdminCapabilityLimit = 200

// AdminListCapabilities handles POST /admin/marketplace/capabilities/list
func AdminListCapabilities(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminListCapabilitiesRequest
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

		limit := int32(defaultAdminCapabilityLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxAdminCapabilityLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxAdminCapabilityLimit
			}
		}

		params := globaldb.ListMarketplaceCapabilitiesParams{
			LimitCount: limit + 1,
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			params.PaginationKey = pgtype.Text{String: *req.PaginationKey, Valid: true}
		}

		rows, err := s.Global.ListMarketplaceCapabilities(ctx, params)
		if err != nil {
			log.Error("failed to list capabilities", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > int(limit)
		if hasMore {
			rows = rows[:limit]
		}

		caps := make([]admintypes.AdminMarketplaceCapability, 0, len(rows))
		for _, row := range rows {
			translations, tErr := s.Global.ListCapabilityTranslations(ctx, row.CapabilityID)
			if tErr != nil {
				log.Error("failed to list translations", "capability_id", row.CapabilityID, "error", tErr)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			caps = append(caps, adminCapabilityToAPI(row, translations))
		}

		var nextKey *string
		if hasMore && len(rows) > 0 {
			last := rows[len(rows)-1]
			nextKey = &last.CapabilityID
		}

		json.NewEncoder(w).Encode(admintypes.AdminListCapabilitiesResponse{
			Capabilities:      caps,
			NextPaginationKey: nextKey,
		})
	}
}

// AdminGetCapability handles POST /admin/marketplace/capabilities/get
func AdminGetCapability(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminGetCapabilityRequest
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

		cap, err := s.Global.GetMarketplaceCapabilityByID(ctx, req.CapabilityID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		translations, err := s.Global.ListCapabilityTranslations(ctx, req.CapabilityID)
		if err != nil {
			log.Error("failed to list translations", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(adminCapabilityToAPI(cap, translations))
	}
}

// AdminCreateCapability handles POST /admin/marketplace/capabilities/create
func AdminCreateCapability(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminCreateCapabilityRequest
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

		var cap globaldb.MarketplaceCapability
		var translations []globaldb.MarketplaceCapabilityTranslation
		err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			var txErr error
			cap, txErr = qtx.CreateMarketplaceCapability(ctx, globaldb.CreateMarketplaceCapabilityParams{
				CapabilityID: req.CapabilityID,
				Status:       string(req.Status),
			})
			if txErr != nil {
				return txErr
			}
			for _, t := range req.Translations {
				txErr = qtx.UpsertCapabilityTranslation(ctx, globaldb.UpsertCapabilityTranslationParams{
					CapabilityID: req.CapabilityID,
					Locale:       t.Locale,
					DisplayName:  t.DisplayName,
					Description:  t.Description,
				})
				if txErr != nil {
					return txErr
				}
			}
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.marketplace_capability_created",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"capability_id":"` + req.CapabilityID + `"}`),
			})
		})
		if err != nil {
			log.Error("failed to create capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		for _, t := range req.Translations {
			translations = append(translations, globaldb.MarketplaceCapabilityTranslation{
				CapabilityID: req.CapabilityID,
				Locale:       t.Locale,
				DisplayName:  t.DisplayName,
				Description:  t.Description,
			})
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(adminCapabilityToAPI(cap, translations))
	}
}

// AdminUpdateCapability handles POST /admin/marketplace/capabilities/update
// Updates translations only (capability_id and status are immutable here).
func AdminUpdateCapability(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminUpdateCapabilityRequest
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

		// Verify capability exists first.
		cap, err := s.Global.GetMarketplaceCapabilityByID(ctx, req.CapabilityID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			for _, t := range req.Translations {
				if txErr := qtx.UpsertCapabilityTranslation(ctx, globaldb.UpsertCapabilityTranslationParams{
					CapabilityID: req.CapabilityID,
					Locale:       t.Locale,
					DisplayName:  t.DisplayName,
					Description:  t.Description,
				}); txErr != nil {
					return txErr
				}
			}
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.marketplace_capability_updated",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"capability_id":"` + req.CapabilityID + `"}`),
			})
		})
		if err != nil {
			log.Error("failed to update capability translations", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		translations, err := s.Global.ListCapabilityTranslations(ctx, req.CapabilityID)
		if err != nil {
			log.Error("failed to list translations", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(adminCapabilityToAPI(cap, translations))
	}
}

// AdminEnableCapability handles POST /admin/marketplace/capabilities/enable
func AdminEnableCapability(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminEnableCapabilityRequest
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

		var cap globaldb.MarketplaceCapability
		err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			var txErr error
			cap, txErr = qtx.EnableMarketplaceCapability(ctx, req.CapabilityID)
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.marketplace_capability_enabled",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"capability_id":"` + req.CapabilityID + `"}`),
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to enable capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		translations, err := s.Global.ListCapabilityTranslations(ctx, req.CapabilityID)
		if err != nil {
			log.Error("failed to list translations", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(adminCapabilityToAPI(cap, translations))
	}
}

// AdminDisableCapability handles POST /admin/marketplace/capabilities/disable
func AdminDisableCapability(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminDisableCapabilityRequest
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

		var cap globaldb.MarketplaceCapability
		err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			var txErr error
			cap, txErr = qtx.DisableMarketplaceCapability(ctx, req.CapabilityID)
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.marketplace_capability_disabled",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"capability_id":"` + req.CapabilityID + `"}`),
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to disable capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		translations, err := s.Global.ListCapabilityTranslations(ctx, req.CapabilityID)
		if err != nil {
			log.Error("failed to list translations", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(adminCapabilityToAPI(cap, translations))
	}
}
