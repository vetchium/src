package org

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/email/templates"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

func RequestPasswordReset(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		var req orgtypes.OrgRequestPasswordResetRequest
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

		// Generic response to prevent email enumeration
		genericResponse := orgtypes.OrgRequestPasswordResetResponse{
			Message: "If an account exists with this email address, a password reset link has been sent.",
		}

		// Look up org by domain
		org, err := s.Global.GetOrgByDomain(ctx, string(req.Domain))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Domain not found - return generic success to prevent enumeration
				s.Logger(ctx).Debug("domain not found", "domain", req.Domain)
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(genericResponse)
				return
			}
			s.Logger(ctx).Error("failed to get org by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Hash email to query global database
		emailHash := sha256.Sum256([]byte(req.EmailAddress))

		// Look up user in global DB
		globalUser, err := s.Global.GetOrgUserByEmailHashAndOrg(ctx, globaldb.GetOrgUserByEmailHashAndOrgParams{
			EmailAddressHash: emailHash[:],
			OrgID:            org.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// User not found - return generic success to prevent enumeration
				s.Logger(ctx).Debug("user not found for this org")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(genericResponse)
				return
			}
			s.Logger(ctx).Error("failed to query global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Select the home region's DB queries. No proxy.
		homeRegion := globalUser.HomeRegion
		homeDB := s.GetRegionalDB(homeRegion)
		if homeDB == nil {
			s.Logger(ctx).Error("no regional pool for home region", "region", homeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get regional user for preferred language
		regionalUser, err := homeDB.GetOrgUserByID(ctx, globalUser.OrgUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// User not found in regional DB - return generic success to prevent enumeration
				s.Logger(ctx).Debug("user not found in regional DB")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(genericResponse)
				return
			}
			s.Logger(ctx).Error("failed to get regional user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate reset token (32 bytes random → 64 char hex + uppercase region prefix)
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			s.Logger(ctx).Error("failed to generate reset token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		plainToken := hex.EncodeToString(tokenBytes)
		resetToken := fmt.Sprintf("%s-%s", strings.ToUpper(string(globalUser.HomeRegion)), plainToken)

		// Compute email content before TX
		preferredLang := regionalUser.PreferredLanguage
		if preferredLang == "" {
			preferredLang = "en-US"
		}

		resetTokenExpiry := s.TokenConfig.PasswordResetTokenExpiry
		expiresAt := time.Now().Add(resetTokenExpiry)
		emailData := templates.OrgPasswordResetData{
			ResetToken: resetToken,
			Domain:     string(req.Domain),
			Hours:      int(resetTokenExpiry.Hours()),
			BaseURL:    s.UIConfig.OrgURL,
		}
		subject := templates.OrgPasswordResetSubject(preferredLang)
		textBody := templates.OrgPasswordResetTextBody(preferredLang, emailData)
		htmlBody := templates.OrgPasswordResetHTMLBody(preferredLang, emailData)

		// Create reset token, enqueue email, and write audit log atomically
		err = s.WithRegionalTxFor(ctx, homeRegion, func(qtx *regionaldb.Queries) error {
			txErr := qtx.CreateOrgPasswordResetToken(ctx, regionaldb.CreateOrgPasswordResetTokenParams{
				ResetToken:      resetToken,
				OrgUserGlobalID: globalUser.OrgUserID,
				ExpiresAt:       pgtype.Timestamptz{Time: expiresAt, Valid: true},
			})
			if txErr != nil {
				return txErr
			}
			if _, txErr = qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
				EmailType:     regionaldb.EmailTemplateTypeOrgPasswordReset,
				EmailTo:       string(req.EmailAddress),
				EmailSubject:  subject,
				EmailTextBody: textBody,
				EmailHtmlBody: htmlBody,
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:    "org.request_password_reset",
				TargetUserID: globalUser.OrgUserID,
				OrgID:        org.OrgID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    []byte("{}"),
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to create reset token and enqueue email", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("password reset requested", "org_user_id", globalUser.OrgUserID)

		// Always return 200 with generic message
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(genericResponse)
	}
}
