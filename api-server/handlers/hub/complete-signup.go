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
	"vetchium-api-server.gomodule/internal/proxy"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/hub"
)

func CompleteSignup(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
			return
		}

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

		// Additional validation: check for duplicate language codes
		// Preferred language cannot appear in other_display_names
		for _, displayName := range req.OtherDisplayNames {
			if displayName.LanguageCode == req.PreferredLanguage {
				log.Debug("duplicate language code in other_display_names", "language", displayName.LanguageCode)
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode([]map[string]string{
					{
						"field":   "other_display_names",
						"message": "Language code cannot be the same as preferred language",
					},
				})
				return
			}
		}

		// Check for duplicate language codes within other_display_names
		seenLanguages := make(map[string]bool)
		for _, displayName := range req.OtherDisplayNames {
			if seenLanguages[displayName.LanguageCode] {
				log.Debug("duplicate language code in other_display_names", "language", displayName.LanguageCode)
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode([]map[string]string{
					{
						"field":   "other_display_names",
						"message": "Duplicate language codes are not allowed",
					},
				})
				return
			}
			seenLanguages[displayName.LanguageCode] = true
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

		// Proxy to correct region if needed
		if globaldb.Region(req.HomeRegion) != s.CurrentRegion {
			s.ProxyToRegion(w, r, globaldb.Region(req.HomeRegion), bodyBytes)
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

		// Execute all global operations in a single transaction
		var globalUser globaldb.HubUser
		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			var txErr error
			globalUser, txErr = qtx.CreateHubUser(ctx, globaldb.CreateHubUserParams{
				Handle:           handle,
				EmailAddressHash: emailHash,
				HashingAlgorithm: globaldb.EmailAddressHashingAlgorithmSHA256,
				HomeRegion:       globaldb.Region(req.HomeRegion),
			})
			if txErr != nil {
				return txErr
			}

			// Create preferred display name
			txErr = qtx.CreateHubUserDisplayName(ctx, globaldb.CreateHubUserDisplayNameParams{
				HubUserGlobalID: globalUser.HubUserGlobalID,
				LanguageCode:    req.PreferredLanguage,
				DisplayName:     string(req.PreferredDisplayName),
				IsPreferred:     true,
			})
			if txErr != nil {
				return txErr
			}

			// Create other display names
			for _, displayName := range req.OtherDisplayNames {
				txErr = qtx.CreateHubUserDisplayName(ctx, globaldb.CreateHubUserDisplayNameParams{
					HubUserGlobalID: globalUser.HubUserGlobalID,
					LanguageCode:    displayName.LanguageCode,
					DisplayName:     string(displayName.DisplayName),
					IsPreferred:     false,
				})
				if txErr != nil {
					return txErr
				}
			}

			// Mark signup token as consumed within the same transaction
			_ = qtx.MarkHubSignupTokenConsumed(ctx, string(req.SignupToken))

			return nil
		})
		if err != nil {
			log.Error("failed global transaction", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		hubUserGlobalID := globalUser.HubUserGlobalID

		// Generate session token before regional TX so we can include it
		sessionTokenBytes := make([]byte, 32)
		if _, err := rand.Read(sessionTokenBytes); err != nil {
			log.Error("failed to generate session token", "error", err)
			// Compensating: delete from global
			if delErr := s.Global.DeleteHubUser(ctx, hubUserGlobalID); delErr != nil {
				log.Error("CONSISTENCY_ALERT: failed to compensate global write",
					"entity_type", "hub_user",
					"entity_id", hubUserGlobalID,
					"intended_action", "delete",
					"error", delErr,
				)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		rawSessionToken := hex.EncodeToString(sessionTokenBytes)

		// Add region prefix to session token
		sessionToken := tokens.AddRegionPrefix(globaldb.Region(req.HomeRegion), rawSessionToken)

		// Execute all regional operations in a single transaction
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			_, txErr := qtx.CreateHubUser(ctx, regionaldb.CreateHubUserParams{
				HubUserGlobalID:     hubUserGlobalID,
				EmailAddress:        email,
				Handle:              handle,
				PasswordHash:        passwordHash,
				Status:              regionaldb.HubUserStatusActive,
				PreferredLanguage:   req.PreferredLanguage,
				ResidentCountryCode: pgtype.Text{String: string(req.ResidentCountryCode), Valid: true},
			})
			if txErr != nil {
				return txErr
			}

			// Assign default hub:read_posts role to every new hub user
			readPostsRole, txErr := qtx.GetRoleByName(ctx, "hub:read_posts")
			if txErr != nil {
				return txErr
			}
			txErr = qtx.AssignHubUserRole(ctx, regionaldb.AssignHubUserRoleParams{
				HubUserGlobalID: hubUserGlobalID,
				RoleID:          readPostsRole.RoleID,
			})
			if txErr != nil {
				return txErr
			}

			sessionExpiresAt := pgtype.Timestamp{Time: time.Now().Add(s.TokenConfig.HubSessionTokenExpiry), Valid: true}
			txErr = qtx.CreateHubSession(ctx, regionaldb.CreateHubSessionParams{
				SessionToken:    rawSessionToken,
				HubUserGlobalID: hubUserGlobalID,
				ExpiresAt:       sessionExpiresAt,
			})
			return txErr
		})
		if err != nil {
			log.Error("failed regional transaction", "error", err)
			// Compensating: delete from global (cascades to display names)
			if delErr := s.Global.DeleteHubUser(ctx, hubUserGlobalID); delErr != nil {
				log.Error("CONSISTENCY_ALERT: failed to compensate global write",
					"entity_type", "hub_user",
					"entity_id", hubUserGlobalID,
					"intended_action", "delete",
					"error", delErr,
				)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

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
