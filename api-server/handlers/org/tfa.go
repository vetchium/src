package org

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/common"
	"vetchium-api-server.typespec/org"
)

func TFA(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var tfaRequest org.OrgTFARequest
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

		// Extract region from TFA token prefix
		region, rawTFAToken, err := tokens.ExtractRegionFromToken(string(tfaRequest.TFAToken))
		if err != nil {
			if errors.Is(err, tokens.ErrMissingPrefix) || errors.Is(err, tokens.ErrInvalidTokenFormat) {
				log.Debug("invalid TFA token format", "error", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if errors.Is(err, tokens.ErrUnknownRegion) {
				log.Debug("unknown region in TFA token", "error", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			log.Error("failed to extract region from TFA token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get the regional database for this region
		regionalDB := s.GetRegionalDB(region)
		if regionalDB == nil {
			log.Error("regional database not available", "region", region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Query the specific regional database using raw token
		tfaTokenRecord, err := regionalDB.GetOrgTFAToken(ctx, rawTFAToken)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("invalid or expired TFA token")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to query TFA token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify TFA code
		if tfaTokenRecord.TfaCode != string(tfaRequest.TFACode) {
			log.Debug("invalid TFA code")
			w.WriteHeader(http.StatusForbidden)
			return
		}

		// NOTE: We intentionally do NOT delete the TFA token here (same as hub).
		// Token expires naturally, and reusing it just creates another session.

		// Get org user from regional database to get preferred language
		regionalUser, err := regionalDB.GetOrgUserByID(ctx, tfaTokenRecord.OrgUserID)
		if err != nil {
			log.Error("failed to fetch regional org user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get employer to return employer_name in response
		employer, err := s.Global.GetEmployerByID(ctx, regionalUser.EmployerID)
		if err != nil {
			log.Error("failed to fetch employer", "error", err)
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
		rawSessionToken := hex.EncodeToString(sessionTokenBytes)

		// Add region prefix to session token
		sessionToken := tokens.AddRegionPrefix(region, rawSessionToken)

		// Determine session expiry based on remember_me flag
		var sessionExpiry time.Duration
		if tfaRequest.RememberMe {
			sessionExpiry = s.TokenConfig.OrgRememberMeExpiry
		} else {
			sessionExpiry = s.TokenConfig.OrgSessionTokenExpiry
		}

		// Store session in regional database (raw token without prefix)
		expiresAt := pgtype.Timestamp{Time: time.Now().Add(sessionExpiry), Valid: true}
		err = regionalDB.CreateOrgSession(ctx, regionaldb.CreateOrgSessionParams{
			SessionToken: rawSessionToken,
			OrgUserID:    tfaTokenRecord.OrgUserID,
			ExpiresAt:    expiresAt,
		})
		if err != nil {
			log.Error("failed to store session", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("org user TFA verified, session created", "org_user_id", regionalUser.OrgUserID, "region", region, "remember_me", tfaRequest.RememberMe)

		response := org.OrgTFAResponse{
			SessionToken:      org.OrgSessionToken(sessionToken),
			PreferredLanguage: common.LanguageCode(regionalUser.PreferredLanguage),
			EmployerName:      employer.EmployerName,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}
