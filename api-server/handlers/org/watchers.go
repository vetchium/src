package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

// AddWatcher adds a single watcher to an opening (requires org:manage_openings).
func AddWatcher(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req struct {
			OpeningID           string `json:"opening_id"`
			WatcherEmailAddress string `json:"watcher_email_address"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if req.OpeningID == "" {
			http.Error(w, "opening_id is required", http.StatusBadRequest)
			return
		}
		if req.WatcherEmailAddress == "" {
			http.Error(w, "watcher_email_address is required", http.StatusBadRequest)
			return
		}

		var openingID pgtype.UUID
		if err := openingID.Scan(req.OpeningID); err != nil {
			http.Error(w, "invalid opening_id", http.StatusBadRequest)
			return
		}

		db := s.RegionalForCtx(ctx)

		// Verify opening belongs to this org
		_, err := db.GetOpeningByID(ctx, regionaldb.GetOpeningByIDParams{
			OpeningID: openingID,
			OrgID:     orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get opening", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Resolve watcher email to org user ID
		watcher, err := db.GetOrgUserByEmailAndOrg(ctx, regionaldb.GetOrgUserByEmailAndOrgParams{
			EmailAddress: req.WatcherEmailAddress,
			OrgID:        orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				http.Error(w, "org user not found", http.StatusBadRequest)
				return
			}
			s.Logger(ctx).Error("failed to get org user", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Enforce 25-watcher cap
		count, err := db.CountOpeningWatchers(ctx, openingID)
		if err != nil {
			s.Logger(ctx).Error("failed to count watchers", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if count >= 25 {
			w.WriteHeader(http.StatusUnprocessableEntity)
			json.NewEncoder(w).Encode(map[string]string{"error": "watcher_cap_reached"})
			return
		}

		eventData, _ := json.Marshal(map[string]any{
			"opening_id":  req.OpeningID,
			"org_user_id": watcher.OrgUserID.String(),
		})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.AddOpeningWatcher(ctx, regionaldb.AddOpeningWatcherParams{
				OpeningID: openingID,
				OrgUserID: watcher.OrgUserID,
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.add_watcher",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to add watcher", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}

// RemoveWatcher removes a single watcher from an opening (requires org:manage_openings).
func RemoveWatcher(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req struct {
			OpeningID string `json:"opening_id"`
			OrgUserID string `json:"org_user_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if req.OpeningID == "" {
			http.Error(w, "opening_id is required", http.StatusBadRequest)
			return
		}
		if req.OrgUserID == "" {
			http.Error(w, "org_user_id is required", http.StatusBadRequest)
			return
		}

		var openingID pgtype.UUID
		if err := openingID.Scan(req.OpeningID); err != nil {
			http.Error(w, "invalid opening_id", http.StatusBadRequest)
			return
		}
		var watcherUserID pgtype.UUID
		if err := watcherUserID.Scan(req.OrgUserID); err != nil {
			http.Error(w, "invalid org_user_id", http.StatusBadRequest)
			return
		}

		db := s.RegionalForCtx(ctx)
		_, err := db.GetOpeningByID(ctx, regionaldb.GetOpeningByIDParams{
			OpeningID: openingID,
			OrgID:     orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get opening", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		eventData, _ := json.Marshal(map[string]any{
			"opening_id":  req.OpeningID,
			"org_user_id": req.OrgUserID,
		})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.RemoveOpeningWatcher(ctx, regionaldb.RemoveOpeningWatcherParams{
				OpeningID: openingID,
				OrgUserID: watcherUserID,
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.remove_watcher",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to remove watcher", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}
