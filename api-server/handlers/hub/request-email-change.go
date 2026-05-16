package hub

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
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/hub"
)

func RequestEmailChange(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req hub.HubRequestEmailChangeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(r.Context()).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx := r.Context()

		// Validate request
		if validationErrors := req.Validate(); len(validationErrors) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				s.Logger(ctx).Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Get authenticated user from context
		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			s.Logger(ctx).Debug("hub user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Check if user is trying to change to the same email
		newEmailHash := sha256.Sum256([]byte(req.NewEmailAddress))
		if string(req.NewEmailAddress) == hubUser.EmailAddress {
			s.Logger(ctx).Debug("new email same as current email")
			w.WriteHeader(http.StatusBadRequest)
			resp := hub.HubRequestEmailChangeResponse{
				Message: "New email address is the same as current email address",
			}
			json.NewEncoder(w).Encode(resp)
			return
		}

		// Check if new email is already in use (global DB)
		existingUser, err := s.Global.GetHubUserByEmailHash(ctx, newEmailHash[:])
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			s.Logger(ctx).Error("failed to check email availability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if existingUser.HubUserGlobalID.Valid {
			s.Logger(ctx).Debug("email already in use")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "email already in use"})
			return
		}

		// Generate verification token (region-prefixed with user's home region,
		// not s.CurrentRegion, so complete-email-change can find it regardless of
		// which regional server handles that request).
		homeRegion := globaldb.Region(middleware.HubRegionFromContext(ctx))
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			s.Logger(ctx).Error("failed to generate random token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		rawToken := hex.EncodeToString(tokenBytes)
		verificationToken := tokens.AddRegionPrefix(homeRegion, rawToken)

		// Create verification token and enqueue email atomically in regional DB
		var expiresAt pgtype.Timestamptz
		expiresAt.Time = time.Now().Add(s.TokenConfig.EmailVerificationTokenExpiry)
		expiresAt.Valid = true

		hours := int(s.TokenConfig.EmailVerificationTokenExpiry.Hours())
		emailData := templates.HubEmailVerificationData{
			VerificationToken: verificationToken,
			NewEmailAddress:   string(req.NewEmailAddress),
			Hours:             hours,
			BaseURL:           s.UIConfig.HubURL,
		}

		subject := templates.HubEmailVerificationSubject(hubUser.PreferredLanguage)
		textBody := templates.HubEmailVerificationTextBody(hubUser.PreferredLanguage, emailData)
		htmlBody := templates.HubEmailVerificationHTMLBody(hubUser.PreferredLanguage, emailData)

		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			txErr := qtx.CreateHubEmailVerificationToken(ctx, regionaldb.CreateHubEmailVerificationTokenParams{
				VerificationToken: rawToken,
				HubUserGlobalID:   hubUser.HubUserGlobalID,
				NewEmailAddress:   string(req.NewEmailAddress),
				ExpiresAt:         expiresAt,
			})
			if txErr != nil {
				return txErr
			}
			if _, txErr = qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
				EmailType:     "hub_email_verification",
				EmailTo:       string(req.NewEmailAddress),
				EmailSubject:  subject,
				EmailTextBody: textBody,
				EmailHtmlBody: htmlBody,
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.request_email_change",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte("{}"),
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to create verification token and enqueue email", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("email verification requested", "hub_user_global_id", hubUser.HubUserGlobalID)

		// Return success response
		resp := hub.HubRequestEmailChangeResponse{
			Message: "Verification email sent to new address",
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
	}
}
