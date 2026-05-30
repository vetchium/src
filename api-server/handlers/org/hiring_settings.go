package org

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	org "vetchium-api-server.typespec/org"
)

// GetHiringSettings returns the org's hiring configuration
func GetHiringSettings(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		settings, err := s.RegionalForCtx(ctx).GetOrgHiringSettings(ctx, orgUser.OrgID)
		if err != nil {
			if err == pgx.ErrNoRows {
				settings = regionaldb.OrgHiringSetting{
					CoolOffDays:                         90,
					AllowUnsolicitedEndorsementsDefault: false,
				}
			} else {
				s.Logger(ctx).Error("failed to get hiring settings", "error", err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"cool_off_days":                          settings.CoolOffDays,
			"allow_unsolicited_endorsements_default": settings.AllowUnsolicitedEndorsementsDefault,
		})
	}
}

// UpdateHiringSettings updates the org's hiring configuration
func UpdateHiringSettings(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.UpdateOrgHiringSettingsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		eventData, _ := json.Marshal(map[string]interface{}{"cool_off_days": req.CoolOffDays})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			allowUnsolicited := false
			if req.AllowUnsolicitedEndorsementsDefault != nil {
				allowUnsolicited = *req.AllowUnsolicitedEndorsementsDefault
			}

			_, txErr := qtx.UpsertOrgHiringSettings(ctx, regionaldb.UpsertOrgHiringSettingsParams{
				OrgID:                               orgUser.OrgID,
				CoolOffDays:                         int32(req.CoolOffDays),
				AllowUnsolicitedEndorsementsDefault: allowUnsolicited,
				UpdatedBy:                           orgUser.OrgUserID,
			})
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.update_hiring_settings",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to update hiring settings", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}
