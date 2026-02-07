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
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/email/templates"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/org"
)

const passwordResetTokenExpiryHours = 1

func RequestPasswordReset(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		var req org.OrgRequestPasswordResetRequest
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

		// Generic response to prevent email enumeration
		genericResponse := org.OrgRequestPasswordResetResponse{
			Message: "If an account exists with this email address, a password reset link has been sent.",
		}

		// Look up employer by domain
		employer, err := s.Global.GetEmployerByDomain(ctx, string(req.Domain))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Domain not found - return generic success to prevent enumeration
				log.Debug("domain not found", "domain", req.Domain)
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(genericResponse)
				return
			}
			log.Error("failed to get employer by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Hash email to query global database
		emailHash := sha256.Sum256([]byte(req.EmailAddress))

		// Look up user in global DB
		globalUser, err := s.Global.GetOrgUserByEmailHashAndEmployer(ctx, globaldb.GetOrgUserByEmailHashAndEmployerParams{
			EmailAddressHash: emailHash[:],
			EmployerID:       employer.EmployerID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// User not found - return generic success to prevent enumeration
				log.Debug("user not found for this employer")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(genericResponse)
				return
			}
			log.Error("failed to query global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get regional DB
		regionalDB := s.GetRegionalDB(globalUser.HomeRegion)
		if regionalDB == nil {
			log.Error("unknown region", "region", globalUser.HomeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get regional user for preferred language
		regionalUser, err := regionalDB.GetOrgUserByID(ctx, globalUser.OrgUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// User not found in regional DB - return generic success to prevent enumeration
				log.Debug("user not found in regional DB")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(genericResponse)
				return
			}
			log.Error("failed to get regional user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate reset token (32 bytes random → 64 char hex + uppercase region prefix)
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			log.Error("failed to generate reset token", "error", err)
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

		expiresAt := time.Now().Add(passwordResetTokenExpiryHours * time.Hour)
		emailData := templates.OrgPasswordResetData{
			ResetToken: resetToken,
			Domain:     string(req.Domain),
			Hours:      passwordResetTokenExpiryHours,
			BaseURL:    s.UIConfig.OrgURL,
		}
		subject := templates.OrgPasswordResetSubject(preferredLang)
		textBody := templates.OrgPasswordResetTextBody(preferredLang, emailData)
		htmlBody := templates.OrgPasswordResetHTMLBody(preferredLang, emailData)

		// Create reset token and enqueue email atomically
		regionalPool := s.GetRegionalPool(globalUser.HomeRegion)
		err = s.WithRegionalTx(ctx, regionalPool, func(qtx *regionaldb.Queries) error {
			txErr := qtx.CreateOrgPasswordResetToken(ctx, regionaldb.CreateOrgPasswordResetTokenParams{
				ResetToken:      resetToken,
				OrgUserGlobalID: globalUser.OrgUserID,
				ExpiresAt:       pgtype.Timestamp{Time: expiresAt, Valid: true},
			})
			if txErr != nil {
				return txErr
			}
			_, txErr = qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
				EmailType:     regionaldb.EmailTemplateTypeOrgPasswordReset,
				EmailTo:       string(req.EmailAddress),
				EmailSubject:  subject,
				EmailTextBody: textBody,
				EmailHtmlBody: htmlBody,
			})
			return txErr
		})
		if err != nil {
			log.Error("failed to create reset token and enqueue email", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("password reset requested", "org_user_id", globalUser.OrgUserID)

		// Always return 200 with generic message
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(genericResponse)
	}
}
