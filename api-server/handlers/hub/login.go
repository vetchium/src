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
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/hub"
)

const (
	hubSessionTokenExpiry = 24 * time.Hour
)

func Login(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var loginRequest hub.HubLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&loginRequest); err != nil {
			s.Logger(r.Context()).Debug("failed to decode login request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		log := s.Logger(ctx)

		// Validate request
		if validationErrors := loginRequest.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				log.Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Hash email to query global database
		emailHash := sha256.Sum256([]byte(loginRequest.EmailAddress))

		// Query global database for user status and home region
		globalUser, err := s.Global.GetHubUserByEmailHash(ctx, emailHash[:])
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("invalid credentials")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			log.Error("failed to query global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if globalUser.Status != globaldb.HubUserStatusActive {
			log.Debug("disabled user")
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Get the regional database for this user
		regionalDB := s.GetRegionalDB(globalUser.HomeRegion)
		if regionalDB == nil {
			log.Error("unknown region", "region", globalUser.HomeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Query regional database for password hash
		regionalUser, err := regionalDB.GetHubUserByEmail(ctx, string(loginRequest.EmailAddress))
		if errors.Is(err, pgx.ErrNoRows) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if err != nil {
			log.Error("failed to query regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify password
		if err := bcrypt.CompareHashAndPassword(regionalUser.PasswordHash, []byte(loginRequest.Password)); err != nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Generate session token
		sessionTokenBytes := make([]byte, 32)
		if _, err := rand.Read(sessionTokenBytes); err != nil {
			log.Error("failed to generate session token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		sessionToken := hex.EncodeToString(sessionTokenBytes)

		// Create session in global DB
		sessionExpiresAt := pgtype.Timestamp{Time: time.Now().Add(hubSessionTokenExpiry), Valid: true}
		err = s.Global.CreateHubSession(ctx, globaldb.CreateHubSessionParams{
			SessionToken:    sessionToken,
			HubUserGlobalID: globalUser.HubUserGlobalID,
			ExpiresAt:       sessionExpiresAt,
		})
		if err != nil {
			log.Error("failed to create session", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("hub user login successful", "hub_user_global_id", globalUser.HubUserGlobalID)

		response := hub.HubLoginResponse{
			SessionToken: hub.HubSessionToken(sessionToken),
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}
