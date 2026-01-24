package org

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/org"
)

func ChangePassword(s *server.Server) http.HandlerFunc {
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

		var req org.OrgChangePasswordRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if validationErrors := req.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				log.Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Get regional DB
		regionalDB := s.GetRegionalDB(orgUser.HomeRegion)
		if regionalDB == nil {
			log.Error("unknown region", "region", orgUser.HomeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get user from regional DB (to get password hash)
		regionalUser, err := regionalDB.GetOrgUserByID(ctx, orgUser.OrgUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Error("user not found in regional DB", "org_user_id", orgUser.OrgUserID)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			log.Error("failed to get user from regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify current password
		err = bcrypt.CompareHashAndPassword(regionalUser.PasswordHash, []byte(req.CurrentPassword))
		if err != nil {
			log.Debug("current password verification failed")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Hash new password
		newPasswordHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			log.Error("failed to hash new password", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update password in regional DB
		err = regionalDB.UpdateOrgUserPassword(ctx, regionaldb.UpdateOrgUserPasswordParams{
			OrgUserID:    orgUser.OrgUserID,
			PasswordHash: newPasswordHash,
		})
		if err != nil {
			log.Error("failed to update password", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get current session token from Authorization header
		sessionToken := ""
		if authHeader := r.Header.Get("Authorization"); authHeader != "" {
			// Format: "Bearer <token>"
			const prefix = "Bearer "
			if len(authHeader) > len(prefix) {
				fullToken := authHeader[len(prefix):]
				// Strip region prefix (format: REGION-rawtoken)
				// Database stores raw token without region prefix
				if idx := strings.Index(fullToken, "-"); idx > 0 {
					sessionToken = fullToken[idx+1:]
				} else {
					sessionToken = fullToken
				}
			}
		}

		// Invalidate all sessions EXCEPT current one
		if sessionToken != "" {
			err = regionalDB.DeleteAllOrgSessionsExceptCurrent(ctx, regionaldb.DeleteAllOrgSessionsExceptCurrentParams{
				OrgUserID:    orgUser.OrgUserID,
				SessionToken: sessionToken,
			})
			if err != nil {
				// Log but don't fail - password is already updated
				log.Error("failed to delete other sessions", "error", err)
			}
		}

		log.Info("password changed successfully", "org_user_id", orgUser.OrgUserID)

		w.WriteHeader(http.StatusOK)
	}
}
