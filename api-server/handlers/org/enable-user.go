package org

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
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

		// Calculate email hash
		emailHash := sha256.Sum256([]byte(req.EmailAddress))

		// Get target user by email hash and employer ID
		targetUser, err := s.Global.GetOrgUserByEmailHashAndEmployer(ctx, globaldb.GetOrgUserByEmailHashAndEmployerParams{
			EmailAddressHash: emailHash[:],
			EmployerID:       orgUser.EmployerID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("target user not found", "email", req.EmailAddress)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get target user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if target user is in disabled state
		if targetUser.Status != globaldb.OrgUserStatusDisabled {
			log.Debug("target user not in disabled state", "status", targetUser.Status)
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Update user status to active in global DB
		err = s.Global.UpdateOrgUserStatus(ctx, globaldb.UpdateOrgUserStatusParams{
			OrgUserID: targetUser.OrgUserID,
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
