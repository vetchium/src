package hub

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/hub"
)

const (
	sessionTokenExpiry = 24 * time.Hour
)

func CompleteSignup(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		var req hub.CompleteSignupRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Verify signup token
		tokenRecord, err := s.Global.GetHubSignupToken(ctx, string(req.SignupToken))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("invalid or expired signup token")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to query signup token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Use email from token record (already verified when token was created)
		email := tokenRecord.EmailAddress
		emailHash := tokenRecord.EmailAddressHash

		// Check if email already registered (duplicate signup during token lifetime)
		_, err = s.Global.GetHubUserByEmailHash(ctx, emailHash)
		if err == nil {
			log.Debug("email already registered")
			w.WriteHeader(http.StatusConflict)
			return
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to query user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Validate home region
		region, err := s.Global.GetRegionByCode(ctx, globaldb.Region(req.HomeRegion))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("invalid home region", "region", req.HomeRegion)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			log.Error("failed to query region", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if !region.IsActive {
			log.Debug("region not active", "region", req.HomeRegion)
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		// Get regional DB for the chosen home region
		regionalDB := s.GetRegionalDB(globaldb.Region(req.HomeRegion))
		if regionalDB == nil {
			log.Error("regional database not available", "region", req.HomeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate handle from email
		handle := generateHandle(email)

		// Hash password
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			log.Error("failed to hash password", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Create user in global DB first (database generates hub_user_global_id)
		globalUser, err := s.Global.CreateHubUser(ctx, globaldb.CreateHubUserParams{
			Handle:              handle,
			EmailAddressHash:    emailHash,
			HashingAlgorithm:    globaldb.EmailAddressHashingAlgorithmSHA256,
			Status:              globaldb.HubUserStatusActive,
			PreferredLanguage:   req.PreferredLanguage,
			HomeRegion:          globaldb.Region(req.HomeRegion),
			ResidentCountryCode: pgtype.Text{String: string(req.ResidentCountryCode), Valid: true},
		})
		if err != nil {
			log.Error("failed to create hub user in global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		hubUserGlobalID := globalUser.HubUserGlobalID

		// Create preferred display name
		err = s.Global.CreateHubUserDisplayName(ctx, globaldb.CreateHubUserDisplayNameParams{
			HubUserGlobalID: hubUserGlobalID,
			LanguageCode:    req.PreferredLanguage,
			DisplayName:     string(req.PreferredDisplayName),
			IsPreferred:     true,
		})
		if err != nil {
			log.Error("failed to create display name", "error", err)
			// Compensating transaction: delete global user
			s.Global.DeleteHubUser(ctx, hubUserGlobalID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Create other display names
		for _, displayName := range req.OtherDisplayNames {
			err = s.Global.CreateHubUserDisplayName(ctx, globaldb.CreateHubUserDisplayNameParams{
				HubUserGlobalID: hubUserGlobalID,
				LanguageCode:    displayName.LanguageCode,
				DisplayName:     string(displayName.DisplayName),
				IsPreferred:     false,
			})
			if err != nil {
				log.Error("failed to create additional display name", "error", err)
				s.Global.DeleteHubUser(ctx, hubUserGlobalID)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
		}

		// Create user in regional DB (database generates hub_user_id)
		regionalUser, err := regionalDB.CreateHubUser(ctx, regionaldb.CreateHubUserParams{
			HubUserGlobalID: hubUserGlobalID,
			EmailAddress:    email,
			PasswordHash:    passwordHash,
		})
		if err != nil {
			log.Error("failed to create hub user in regional DB", "error", err)
			// Compensating transaction: delete from global
			s.Global.DeleteHubUser(ctx, hubUserGlobalID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate session token
		sessionTokenBytes := make([]byte, 32)
		if _, err := rand.Read(sessionTokenBytes); err != nil {
			log.Error("failed to generate session token", "error", err)
			// Cleanup
			regionalDB.DeleteHubUser(ctx, regionalUser.HubUserID)
			s.Global.DeleteHubUser(ctx, hubUserGlobalID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		sessionToken := hex.EncodeToString(sessionTokenBytes)

		// Create session in global DB
		sessionExpiresAt := pgtype.Timestamp{Time: time.Now().Add(sessionTokenExpiry), Valid: true}
		err = s.Global.CreateHubSession(ctx, globaldb.CreateHubSessionParams{
			SessionToken:    sessionToken,
			HubUserGlobalID: hubUserGlobalID,
			ExpiresAt:       sessionExpiresAt,
		})
		if err != nil {
			log.Error("failed to create session", "error", err)
			// Cleanup
			regionalDB.DeleteHubUser(ctx, regionalUser.HubUserID)
			s.Global.DeleteHubUser(ctx, hubUserGlobalID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Mark signup token as consumed (best effort, non-critical)
		_ = s.Global.MarkHubSignupTokenConsumed(ctx, string(req.SignupToken))

		log.Info("hub user signup completed", "hub_user_global_id", hubUserGlobalID, "handle", handle)

		w.WriteHeader(http.StatusCreated)
		response := hub.CompleteSignupResponse{
			SessionToken: hub.HubSessionToken(sessionToken),
			Handle:       hub.Handle(handle),
		}
		json.NewEncoder(w).Encode(response)
	}
}

// generateHandle creates a unique handle from an email address
func generateHandle(email string) string {
	// Extract local part before @
	parts := strings.Split(email, "@")
	if len(parts) != 2 {
		// Fallback to random handle if email is malformed
		return generateRandomHandle()
	}
	localPart := parts[0]

	// Sanitize: remove special chars except dot, convert to lowercase
	localPart = strings.ToLower(localPart)
	// Replace dots with hyphens
	localPart = strings.ReplaceAll(localPart, ".", "-")
	// Remove all non-alphanumeric characters except hyphens
	reg := regexp.MustCompile(`[^a-z0-9-]`)
	localPart = reg.ReplaceAllString(localPart, "")
	// Remove consecutive hyphens
	reg = regexp.MustCompile(`-+`)
	localPart = reg.ReplaceAllString(localPart, "-")
	// Trim hyphens from start and end
	localPart = strings.Trim(localPart, "-")

	// Ensure not empty
	if localPart == "" {
		localPart = "user"
	}

	// Truncate if too long (leave room for UUID suffix + hyphen)
	if len(localPart) > 40 {
		localPart = localPart[:40]
	}

	// Generate 8-char random suffix for uniqueness
	suffixBytes := make([]byte, 4)
	rand.Read(suffixBytes)
	suffix := hex.EncodeToString(suffixBytes)

	return fmt.Sprintf("%s-%s", localPart, suffix)
}

// generateRandomHandle creates a random handle as fallback
func generateRandomHandle() string {
	randomBytes := make([]byte, 4)
	rand.Read(randomBytes)
	suffix := hex.EncodeToString(randomBytes)
	return "user-" + suffix
}
