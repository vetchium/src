package org

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/org"
)

func EnableUser(s *server.RegionalServer) http.HandlerFunc {
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

		// Decode request
		var req org.OrgEnableUserRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Calculate email hash
		emailHash := sha256.Sum256([]byte(req.EmailAddress))

		// Get target user from global DB to find their region
		globalTargetUser, err := s.Global.GetOrgUserByEmailHashAndOrg(ctx, globaldb.GetOrgUserByEmailHashAndOrgParams{
			EmailAddressHash: emailHash[:],
			OrgID:            orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("target user not found", "email", req.EmailAddress)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get target user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get target user from regional DB (has status)
		targetUser, err := s.RegionalForCtx(ctx).GetOrgUserByID(ctx, globalTargetUser.OrgUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("target user not found in regional DB")
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get target user from regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if target user is in disabled state
		if targetUser.Status != regionaldb.OrgUserStatusDisabled {
			s.Logger(ctx).Debug("target user not in disabled state", "status", targetUser.Status)
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Update user status to active and write audit log atomically
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.UpdateOrgUserStatus(ctx, regionaldb.UpdateOrgUserStatusParams{
				OrgUserID: targetUser.OrgUserID,
				Status:    regionaldb.OrgUserStatusActive,
			}); txErr != nil {
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{
				"target_user_id":    targetUser.OrgUserID.String(),
				"target_email_hash": hex.EncodeToString(emailHash[:]),
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:    "org.enable_user",
				ActorUserID:  orgUser.OrgUserID,
				TargetUserID: targetUser.OrgUserID,
				OrgID:        orgUser.OrgID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    eventData,
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to update user status", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("org user enabled successfully",
			"target_user_id", targetUser.OrgUserID,
			"enabled_by", orgUser.OrgUserID)

		w.WriteHeader(http.StatusOK)
	}
}
