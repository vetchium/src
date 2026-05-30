package hub

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	hub "vetchium-api-server.typespec/hub"
)

func GetApplyPreferences(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		prefs, err := s.RegionalForCtx(ctx).GetHubApplyPreferences(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			// No row means default preferences (both false)
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(hub.HubApplyPreferences{
				NotifyConnectionsOnApply:     false,
				AllowUnsolicitedEndorsements: false,
			})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(hub.HubApplyPreferences{
			NotifyConnectionsOnApply:     prefs.NotifyConnectionsOnApply,
			AllowUnsolicitedEndorsements: prefs.AllowUnsolicitedEndorsements,
		})
	}
}

func SetNotifyConnectionsOnApply(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.SetNotifyConnectionsOnApplyRequest
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

		// Read current prefs to preserve the other field
		current, _ := s.RegionalForCtx(ctx).GetHubApplyPreferences(ctx, hubUser.HubUserGlobalID)

		eventData, _ := json.Marshal(map[string]interface{}{
			"notify_connections_on_apply": req.NotifyConnectionsOnApply,
		})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if err := qtx.UpsertHubApplyPreferences(ctx, regionaldb.UpsertHubApplyPreferencesParams{
				HubUserGlobalID:              hubUser.HubUserGlobalID,
				NotifyConnectionsOnApply:     req.NotifyConnectionsOnApply,
				AllowUnsolicitedEndorsements: current.AllowUnsolicitedEndorsements,
			}); err != nil {
				return err
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.set_notify_connections_on_apply",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to update notification preference", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

func SetAllowUnsolicitedEndorsements(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.SetAllowUnsolicitedEndorsementsRequest
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

		current, _ := s.RegionalForCtx(ctx).GetHubApplyPreferences(ctx, hubUser.HubUserGlobalID)

		eventData, _ := json.Marshal(map[string]interface{}{
			"allow_unsolicited_endorsements": req.AllowUnsolicitedEndorsements,
		})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if err := qtx.UpsertHubApplyPreferences(ctx, regionaldb.UpsertHubApplyPreferencesParams{
				HubUserGlobalID:              hubUser.HubUserGlobalID,
				NotifyConnectionsOnApply:     current.NotifyConnectionsOnApply,
				AllowUnsolicitedEndorsements: req.AllowUnsolicitedEndorsements,
			}); err != nil {
				return err
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.set_allow_unsolicited_endorsements",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to update endorsement preference", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}
