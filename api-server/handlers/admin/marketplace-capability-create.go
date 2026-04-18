package admin

import (
	"encoding/json"
	"net/http"
	"strings"

	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func CreateMarketplaceCapability(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.AdminCreateCapabilityRequest
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

		description := ""
		if req.Description != nil {
			description = *req.Description
		}

		eventData, _ := json.Marshal(map[string]any{
			"capability_id": req.CapabilityID,
		})

		err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			if err := qtx.CreateCapability(ctx, globaldb.CreateCapabilityParams{
				CapabilityID: req.CapabilityID,
				Status:       "draft",
			}); err != nil {
				return err
			}
			if err := qtx.UpsertCapabilityTranslation(ctx, globaldb.UpsertCapabilityTranslationParams{
				CapabilityID: req.CapabilityID,
				Locale:       "en-US",
				DisplayName:  req.DisplayName,
				Description:  description,
			}); err != nil {
				return err
			}
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.marketplace_capability_created",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
				w.WriteHeader(http.StatusConflict)
				return
			}
			s.Logger(ctx).Error("failed to create capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		cap := orgspec.MarketplaceCapability{
			CapabilityID: req.CapabilityID,
			DisplayName:  req.DisplayName,
			Description:  description,
			Status:       orgspec.CapabilityStatusDraft,
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(cap)
	}
}
