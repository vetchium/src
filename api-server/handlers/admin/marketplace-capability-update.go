package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func UpdateMarketplaceCapability(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.AdminUpdateCapabilityRequest
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

		eventData, _ := json.Marshal(map[string]any{
			"capability_id": req.CapabilityID,
			"status":        string(req.Status),
		})

		err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			if err := qtx.UpdateCapabilityStatus(ctx, globaldb.UpdateCapabilityStatusParams{
				CapabilityID: req.CapabilityID,
				Status:       string(req.Status),
			}); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return pgx.ErrNoRows
				}
				return err
			}

			if req.DisplayName != nil || req.Description != nil {
				existing, err := qtx.GetCapability(ctx, globaldb.GetCapabilityParams{
					Locale:       "en-US",
					CapabilityID: req.CapabilityID,
				})
				if err != nil {
					return err
				}
				displayName := existing.DisplayName
				description := existing.Description
				if req.DisplayName != nil {
					displayName = *req.DisplayName
				}
				if req.Description != nil {
					description = *req.Description
				}
				if err := qtx.UpsertCapabilityTranslation(ctx, globaldb.UpsertCapabilityTranslationParams{
					CapabilityID: req.CapabilityID,
					Locale:       "en-US",
					DisplayName:  displayName,
					Description:  description,
				}); err != nil {
					return err
				}
			}

			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.marketplace_capability_updated",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to update capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		cap, err := s.Global.GetCapability(ctx, globaldb.GetCapabilityParams{
			Locale:       "en-US",
			CapabilityID: req.CapabilityID,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to re-fetch capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(orgspec.MarketplaceCapability{
			CapabilityID: cap.CapabilityID,
			DisplayName:  cap.DisplayName,
			Description:  cap.Description,
			Status:       orgspec.CapabilityStatus(cap.Status),
		})
	}
}
