package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/org"
)

func EnableUser(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		// Get authenticated org user from context
		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			log.Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Decode request
		var req org.OrgEnableUserRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Parse target user ID
		var targetUserID pgtype.UUID
		if err := targetUserID.Scan(req.TargetUserID); err != nil {
			log.Debug("invalid target_user_id format", "error", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		// Get target user from global DB
		targetUser, err := s.Global.GetOrgUserByID(ctx, targetUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("target user not found", "target_user_id", req.TargetUserID)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get target user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if target user belongs to the same employer
		if targetUser.EmployerID != orgUser.EmployerID {
			log.Debug("target user belongs to different employer")
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Check if target user is in disabled state
		if targetUser.Status != globaldb.OrgUserStatusDisabled {
			log.Debug("target user not in disabled state", "status", targetUser.Status)
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Check if current user has permission (is_admin or has manage_users role)
		// TODO: Once role system is implemented, check for manage_users role here
		if !orgUser.IsAdmin {
			log.Debug("user lacks permission to enable users")
			w.WriteHeader(http.StatusForbidden)
			return
		}

		// Update user status to active in global DB
		err = s.Global.UpdateOrgUserStatus(ctx, globaldb.UpdateOrgUserStatusParams{
			OrgUserID: targetUserID,
			Status:    globaldb.OrgUserStatusActive,
		})
		if err != nil {
			log.Error("failed to update user status", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("org user enabled successfully",
			"target_user_id", targetUser.OrgUserID,
			"enabled_by", orgUser.OrgUserID)

		w.WriteHeader(http.StatusOK)
	}
}
