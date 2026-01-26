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
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/email/templates"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/hub"
)

func RequestEmailChange(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req hub.HubRequestEmailChangeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(r.Context()).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		log := s.Logger(ctx)

		// Validate request
		if validationErrors := req.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				log.Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Get authenticated user from context
		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			log.Debug("hub user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		region := middleware.HubRegionFromContext(ctx)
		if region == "" {
			log.Debug("hub region not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Check if user is trying to change to the same email (compare hashes)
		newEmailHash := sha256.Sum256([]byte(req.NewEmailAddress))
		if hex.EncodeToString(hubUser.EmailAddressHash) == hex.EncodeToString(newEmailHash[:]) {
			log.Debug("new email same as current email")
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
			log.Error("failed to check email availability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if existingUser.HubUserGlobalID.String() != "" && existingUser.Status == globaldb.HubUserStatusActive {
			log.Debug("email already in use")
			w.WriteHeader(http.StatusConflict)
			return
		}

		// Convert region string to globaldb.Region
		var regionType globaldb.Region
		switch region {
		case "ind1":
			regionType = globaldb.RegionInd1
		case "usa1":
			regionType = globaldb.RegionUsa1
		case "deu1":
			regionType = globaldb.RegionDeu1
		default:
			log.Error("invalid region", "region", region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get regional database
		regionalDB := s.GetRegionalDB(regionType)
		if regionalDB == nil {
			log.Error("unknown region", "region", region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate verification token (region-prefixed)
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			log.Error("failed to generate random token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		rawToken := hex.EncodeToString(tokenBytes)
		verificationToken := tokens.AddRegionPrefix(regionType, rawToken)

		// Create verification token in regional DB
		var expiresAt pgtype.Timestamp
		expiresAt.Time = time.Now().Add(s.TokenConfig.EmailVerificationTokenExpiry)
		expiresAt.Valid = true

		err = regionalDB.CreateHubEmailVerificationToken(ctx, regionaldb.CreateHubEmailVerificationTokenParams{
			VerificationToken: rawToken,
			HubUserGlobalID:   hubUser.HubUserGlobalID,
			NewEmailAddress:   string(req.NewEmailAddress),
			ExpiresAt:         expiresAt,
		})
		if err != nil {
			log.Error("failed to create verification token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Send verification email to NEW email address
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

		_, err = regionalDB.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
			EmailType:     "hub_email_verification",
			EmailTo:       string(req.NewEmailAddress),
			EmailSubject:  subject,
			EmailTextBody: textBody,
			EmailHtmlBody: htmlBody,
		})
		if err != nil {
			log.Error("failed to enqueue email", "error", err)
			// Compensating transaction: delete token
			if delErr := regionalDB.DeleteHubEmailVerificationToken(ctx, rawToken); delErr != nil {
				log.Error("failed to delete verification token after email failure", "error", delErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("email verification requested", "hub_user_global_id", hubUser.HubUserGlobalID)

		// Return success response
		resp := hub.HubRequestEmailChangeResponse{
			Message: "Verification email sent to new address",
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
	}
}
