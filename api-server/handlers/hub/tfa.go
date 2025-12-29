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
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/common"
	"vetchium-api-server.typespec/hub"
)

func TFA(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var tfaRequest hub.HubTFARequest
		if err := json.NewDecoder(r.Body).Decode(&tfaRequest); err != nil {
			s.Logger(r.Context()).Debug("failed to decode TFA request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		log := s.Logger(ctx)

		// Validate request
		if validationErrors := tfaRequest.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				log.Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// We need to find which regional database has this TFA token
		// Try each regional database until we find the token
		var tfaTokenRecord *struct {
			HubUserID pgtype.UUID
			TfaCode   string
		}
		var regionalDB *regionaldb.Queries

		for _, region := range []globaldb.Region{globaldb.RegionInd1, globaldb.RegionUsa1, globaldb.RegionDeu1} {
			db := s.GetRegionalDB(region)
			if db == nil {
				continue
			}

			record, err := db.GetHubTFAToken(ctx, string(tfaRequest.TFAToken))
			if err == nil {
				tfaTokenRecord = &struct {
					HubUserID pgtype.UUID
					TfaCode   string
				}{
					HubUserID: record.HubUserID,
					TfaCode:   record.TfaCode,
				}
				regionalDB = db
				break
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				log.Error("failed to query TFA token", "region", region, "error", err)
			}
		}

		if tfaTokenRecord == nil {
			log.Debug("invalid or expired TFA token")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Verify TFA code
		if tfaTokenRecord.TfaCode != string(tfaRequest.TFACode) {
			log.Debug("invalid TFA code")
			w.WriteHeader(http.StatusForbidden)
			return
		}

		// NOTE: We intentionally do NOT delete the TFA token here.
		//
		// If we deleted the token and then session creation or response sending
		// failed, the user would be unable to retry (token gone, no session).
		// They'd have to restart the entire login flow.
		//
		// By keeping the token, the user can retry TFA verification if something
		// fails. The token expires naturally after 10 minutes, which is sufficient
		// protection. Reusing a valid token just creates another session for the
		// same authenticated user - not a security issue.

		// Get hub user from regional database to get email address
		regionalUser, err := regionalDB.GetHubUserByID(ctx, tfaTokenRecord.HubUserID)
		if err != nil {
			log.Error("failed to fetch regional hub user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get hub user from global database to get preferred language
		emailHash := sha256.Sum256([]byte(regionalUser.EmailAddress))
		globalUser, err := s.Global.GetHubUserByEmailHash(ctx, emailHash[:])
		if err != nil {
			log.Error("failed to fetch global hub user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
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

		// Determine session expiry based on remember_me flag
		var sessionExpiry time.Duration
		if tfaRequest.RememberMe {
			sessionExpiry = rememberMeExpiry
		} else {
			sessionExpiry = hubSessionTokenExpiry
		}

		// Store session in global database
		expiresAt := pgtype.Timestamp{Time: time.Now().Add(sessionExpiry), Valid: true}
		err = s.Global.CreateHubSession(ctx, globaldb.CreateHubSessionParams{
			SessionToken:    sessionToken,
			HubUserGlobalID: globalUser.HubUserGlobalID,
			ExpiresAt:       expiresAt,
		})
		if err != nil {
			log.Error("failed to store session", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("hub user TFA verified, session created", "hub_user_global_id", globalUser.HubUserGlobalID, "remember_me", tfaRequest.RememberMe)

		response := hub.HubTFAResponse{
			SessionToken:      hub.HubSessionToken(sessionToken),
			PreferredLanguage: common.LanguageCode(globalUser.PreferredLanguage),
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}
