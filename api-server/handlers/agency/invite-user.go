package agency

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/email/templates"
	"vetchium-api-server.gomodule/internal/i18n"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	agencytypes "vetchium-api-server.typespec/agency"
	common "vetchium-api-server.typespec/common"
)

func InviteUser(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		// Get authenticated agency user from context
		agencyUser := middleware.AgencyUserFromContext(ctx)
		if agencyUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Decode request
		var req agencytypes.AgencyInviteUserRequest
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

		// Hash email for global DB lookup
		emailHash := sha256.Sum256([]byte(req.EmailAddress))

		// Check if user already exists for this agency in global DB
		_, err := s.Global.GetAgencyUserByEmailHashAndAgency(ctx, globaldb.GetAgencyUserByEmailHashAndAgencyParams{
			EmailAddressHash: emailHash[:],
			AgencyID:         agencyUser.AgencyID,
		})
		if err == nil {
			// User already exists for this agency
			s.Logger(ctx).Debug("user already exists for this agency", "email_hash", hex.EncodeToString(emailHash[:]))
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "User with this email already exists for this agency",
			})
			return
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			s.Logger(ctx).Error("failed to check if user exists", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Resolve role IDs before creating any records
		var roleIDs []pgtype.UUID
		for _, roleName := range req.Roles {
			role, err := s.Regional.GetRoleByName(ctx, string(roleName))
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					s.Logger(ctx).Debug("role not found", "role_name", roleName)
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode([]common.ValidationError{
						common.NewValidationError("roles", common.ErrRoleNameInvalid),
					})
					return
				}
				s.Logger(ctx).Error("failed to get role", "error", err, "role_name", roleName)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			roleIDs = append(roleIDs, role.RoleID)
		}

		// Pre-fetch inviter and agency info (needed for email template)
		inviter, err := s.Regional.GetAgencyUserByID(ctx, agencyUser.AgencyUserID)
		if err != nil {
			s.Logger(ctx).Error("failed to get inviter info", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		agencyEntity, err := s.Global.GetAgencyByID(ctx, agencyUser.AgencyID)
		if err != nil {
			s.Logger(ctx).Error("failed to get agency info", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Create agency user in global DB (routing data only)
		globalUser, err := s.Global.CreateAgencyUser(ctx, globaldb.CreateAgencyUserParams{
			EmailAddressHash: emailHash[:],
			HashingAlgorithm: globaldb.EmailAddressHashingAlgorithmSHA256,
			AgencyID:         agencyUser.AgencyID,
			HomeRegion:       s.CurrentRegion,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to create agency user in global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate invitation token
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			s.Logger(ctx).Error("failed to generate invitation token", "error", err)
			if delErr := s.Global.DeleteAgencyUser(ctx, globalUser.AgencyUserID); delErr != nil {
				s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to delete agency user from global DB", "error", delErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		rawToken := hex.EncodeToString(tokenBytes)
		invitationToken := tokens.AddRegionPrefix(s.CurrentRegion, rawToken)

		// Build email content before tx
		invitationExpiry := s.TokenConfig.AgencyInvitationTokenExpiry
		expiresAt := pgtype.Timestamp{Time: time.Now().Add(invitationExpiry), Valid: true}
		emailLanguage := agencyUser.PreferredLanguage
		if req.InviteEmailLanguage != "" {
			emailLanguage = string(req.InviteEmailLanguage)
		}
		lang := i18n.Match(emailLanguage)
		inviterName := inviter.FullName.String
		if inviterName == "" {
			inviterName = inviter.EmailAddress
		}
		emailData := templates.AgencyInvitationData{
			InvitationToken: invitationToken,
			InviterName:     inviterName,
			AgencyName:      agencyEntity.AgencyName,
			Days:            int(invitationExpiry.Hours() / 24),
			BaseURL:         s.UIConfig.AgencyURL,
		}

		// Wrap regional operations in a transaction
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// Create agency user in regional DB (without password hash)
			if _, txErr := qtx.CreateAgencyUser(ctx, regionaldb.CreateAgencyUserParams{
				AgencyUserID: globalUser.AgencyUserID,
				EmailAddress: string(req.EmailAddress),
				AgencyID:     agencyUser.AgencyID,
				FullName: pgtype.Text{
					Valid: false,
				},
				PasswordHash:      nil,
				Status:            regionaldb.AgencyUserStatusInvited,
				PreferredLanguage: "en-US",
			}); txErr != nil {
				return txErr
			}

			// Create invitation token in regional DB
			if txErr := qtx.CreateAgencyInvitationToken(ctx, regionaldb.CreateAgencyInvitationTokenParams{
				InvitationToken: rawToken,
				AgencyUserID:    globalUser.AgencyUserID,
				AgencyID:        agencyUser.AgencyID,
				ExpiresAt:       expiresAt,
			}); txErr != nil {
				return txErr
			}

			// Assign roles to invited user
			for _, roleID := range roleIDs {
				if txErr := qtx.AssignAgencyUserRole(ctx, regionaldb.AssignAgencyUserRoleParams{
					AgencyUserID: globalUser.AgencyUserID,
					RoleID:       roleID,
				}); txErr != nil {
					return txErr
				}
			}

			// Enqueue invitation email
			if _, txErr := qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
				EmailType:     regionaldb.EmailTemplateTypeAgencyInvitation,
				EmailTo:       string(req.EmailAddress),
				EmailSubject:  templates.AgencyInvitationSubject(lang, emailData),
				EmailTextBody: templates.AgencyInvitationTextBody(lang, emailData),
				EmailHtmlBody: templates.AgencyInvitationHTMLBody(lang, emailData),
			}); txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]any{"invited_email_hash": hex.EncodeToString(emailHash[:])})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:    "agency.invite_user",
				ActorUserID:  agencyUser.AgencyUserID,
				TargetUserID: globalUser.AgencyUserID,
				OrgID:        agencyUser.AgencyID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    eventData,
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to create agency user in regional DB", "error", err)
			// Compensating transaction: delete from global DB
			if delErr := s.Global.DeleteAgencyUser(ctx, globalUser.AgencyUserID); delErr != nil {
				s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to delete agency user from global DB after regional tx failure", "error", delErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("user invited successfully", "org_user_id", globalUser.AgencyUserID, "inviter_id", agencyUser.AgencyUserID)

		// Return response
		response := agencytypes.AgencyInviteUserResponse{
			InvitationID: globalUser.AgencyUserID.String(),
			ExpiresAt:    expiresAt.Time.Format(time.RFC3339),
		}

		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("failed to encode response", "error", err)
		}
	}
}
