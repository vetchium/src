package org

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/org"
)

func ChangePassword(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		// Get authenticated org user from context
		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.OrgChangePasswordRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if validationErrors := req.Validate(); len(validationErrors) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				s.Logger(ctx).Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Get user from regional DB (to get password hash)
		regionalUser, err := s.RegionalForCtx(ctx).GetOrgUserByID(ctx, orgUser.OrgUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Error("user not found in regional DB", "org_user_id", orgUser.OrgUserID)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			s.Logger(ctx).Error("failed to get user from regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify current password
		err = bcrypt.CompareHashAndPassword(regionalUser.PasswordHash, []byte(req.CurrentPassword))
		if err != nil {
			s.Logger(ctx).Debug("current password verification failed")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Hash new password
		newPasswordHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			s.Logger(ctx).Error("failed to hash new password", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Extract current session token BEFORE TX
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

		// Update password, invalidate sessions, and write audit log atomically
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			txErr := qtx.UpdateOrgUserPassword(ctx, regionaldb.UpdateOrgUserPasswordParams{
				OrgUserID:    orgUser.OrgUserID,
				PasswordHash: newPasswordHash,
			})
			if txErr != nil {
				return txErr
			}
			if sessionToken != "" {
				if txErr = qtx.DeleteAllOrgSessionsExceptCurrent(ctx, regionaldb.DeleteAllOrgSessionsExceptCurrentParams{
					OrgUserID:    orgUser.OrgUserID,
					SessionToken: sessionToken,
				}); txErr != nil {
					return txErr
				}
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.change_password",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte("{}"),
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to update password", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("password changed successfully", "org_user_id", orgUser.OrgUserID)

		w.WriteHeader(http.StatusOK)
	}
}
