package agency

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
	"vetchium-api-server.gomodule/internal/proxy"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/agency"
)

const passwordResetTokenExpiryHours = 1

func RequestPasswordReset(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		log := s.Logger(ctx)

		var req agency.AgencyRequestPasswordResetRequest
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
		genericResponse := agency.AgencyRequestPasswordResetResponse{
			Message: "If an account exists with this email address, a password reset link has been sent.",
		}

		// Look up agency by domain
		agencyRecord, err := s.Global.GetAgencyByDomain(ctx, string(req.Domain))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Domain not found - return generic success to prevent enumeration
				log.Debug("domain not found", "domain", req.Domain)
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(genericResponse)
				return
			}
			log.Error("failed to get agency by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Hash email to query global database
		emailHash := sha256.Sum256([]byte(req.EmailAddress))

		// Look up user in global DB
		globalUser, err := s.Global.GetAgencyUserByEmailHashAndAgency(ctx, globaldb.GetAgencyUserByEmailHashAndAgencyParams{
			EmailAddressHash: emailHash[:],
			AgencyID:         agencyRecord.AgencyID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// User not found - return generic success to prevent enumeration
				log.Debug("user not found for this agency")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(genericResponse)
				return
			}
			log.Error("failed to query global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Proxy to correct region if needed
		if globalUser.HomeRegion != s.CurrentRegion {
			s.ProxyToRegion(w, r, globalUser.HomeRegion, bodyBytes)
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

		// Get regional user for preferred language (before TX)
		expiresAt := time.Now().Add(passwordResetTokenExpiryHours * time.Hour)
		regionalUser, err := s.Regional.GetAgencyUserByID(ctx, globalUser.AgencyUserID)
		if err != nil {
			log.Error("failed to get regional user for language preference", "error", err)
		}
		preferredLang := "en-US"
		if err == nil && regionalUser.PreferredLanguage != "" {
			preferredLang = regionalUser.PreferredLanguage
		}

		// Compute email content before TX
		emailData := templates.AgencyPasswordResetData{
			ResetToken: resetToken,
			Domain:     string(req.Domain),
			Hours:      passwordResetTokenExpiryHours,
			BaseURL:    s.UIConfig.AgencyURL,
		}
		subject := templates.AgencyPasswordResetSubject(preferredLang)
		textBody := templates.AgencyPasswordResetTextBody(preferredLang, emailData)
		htmlBody := templates.AgencyPasswordResetHTMLBody(preferredLang, emailData)

		// Create reset token and enqueue email atomically
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			txErr := qtx.CreateAgencyPasswordResetToken(ctx, regionaldb.CreateAgencyPasswordResetTokenParams{
				ResetToken:         resetToken,
				AgencyUserGlobalID: globalUser.AgencyUserID,
				ExpiresAt:          pgtype.Timestamp{Time: expiresAt, Valid: true},
			})
			if txErr != nil {
				return txErr
			}
			_, txErr = qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
				EmailType:     regionaldb.EmailTemplateTypeAgencyPasswordReset,
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

		log.Info("password reset requested", "agency_user_id", globalUser.AgencyUserID)

		// Always return 200 with generic message
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(genericResponse)
	}
}
