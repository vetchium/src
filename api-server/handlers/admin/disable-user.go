package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

func DisableUser(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		// Get authenticated admin user from context
		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			s.Logger(ctx).Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Decode request
		var req admin.AdminDisableUserRequest
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

		// Get target user by email from global DB (outside tx, for identity lookup)
		targetUser, err := s.Global.GetAdminUserByEmail(ctx, string(req.EmailAddress))
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

		// The last-admin check and the status update are inside a single
		// transaction to prevent race conditions (e.g. two parallel requests
		// both trying to disable the last active admin).
		var targetUserID pgtype.UUID
		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			// Re-read target user to get latest status inside the transaction
			currentTarget, err := qtx.GetAdminUserByEmail(ctx, string(req.EmailAddress))
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return server.ErrNotFound
				}
				return err
			}
			targetUserID = currentTarget.AdminUserID

			// Check if target user is already disabled
			if currentTarget.Status == globaldb.AdminUserStatusDisabled {
				return server.ErrInvalidState
			}

			// Lock all active admin users to serialize the last-admin check
			activeAdmins, err := qtx.LockActiveAdminUsers(ctx)
			if err != nil {
				return err
			}

			if len(activeAdmins) <= 1 {
				return server.ErrInvalidState
			}

			if err := qtx.UpdateAdminUserStatus(ctx, globaldb.UpdateAdminUserStatusParams{
				AdminUserID: currentTarget.AdminUserID,
				Status:      globaldb.AdminUserStatusDisabled,
			}); err != nil {
				return err
			}
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:    "admin.disable_user",
				ActorUserID:  adminUser.AdminUserID,
				TargetUserID: currentTarget.AdminUserID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    []byte("{}"),
			})
		})
		if err != nil {
			if errors.Is(err, server.ErrNotFound) {
				s.Logger(ctx).Debug("target user not found")
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if errors.Is(err, server.ErrInvalidState) {
				s.Logger(ctx).Debug("cannot disable user - already disabled or last admin")
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "Cannot disable user: already disabled or last admin",
				})
				return
			}
			s.Logger(ctx).Error("failed to disable admin user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Invalidate all sessions for the target user (best-effort, outside tx)
		if err := s.Global.DeleteAllAdminSessionsForUser(ctx, targetUserID); err != nil {
			s.Logger(ctx).Error("failed to delete user sessions", "error", err)
			// User is disabled but sessions still active - this is acceptable
		}

		s.Logger(ctx).Info("admin user disabled successfully",
			"target_user_id", targetUser.AdminUserID,
			"disabled_by", adminUser.AdminUserID)

		w.WriteHeader(http.StatusOK)
	}
}
