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
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/common"
	orgtypes "vetchium-api-server.typespec/org"
)

func TFA(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var tfaRequest orgtypes.OrgTFARequest
		if err := json.NewDecoder(r.Body).Decode(&tfaRequest); err != nil {
			s.Logger(r.Context()).Debug("failed to decode TFA request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx := r.Context()

		// Validate request
		if validationErrors := tfaRequest.Validate(); len(validationErrors) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				s.Logger(ctx).Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Extract region from TFA token prefix
		region, rawTFAToken, err := tokens.ExtractRegionFromToken(string(tfaRequest.TFAToken))
		if err != nil {
			if errors.Is(err, tokens.ErrMissingPrefix) || errors.Is(err, tokens.ErrInvalidTokenFormat) {
				s.Logger(ctx).Debug("invalid TFA token format", "error", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if errors.Is(err, tokens.ErrUnknownRegion) {
				s.Logger(ctx).Debug("unknown region in TFA token", "error", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			s.Logger(ctx).Error("failed to extract region from TFA token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Look up the home region's DB queries. No proxy.
		homeDB := s.GetRegionalDB(region)
		if homeDB == nil {
			s.Logger(ctx).Error("no regional pool for home region", "region", region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Query the regional database using raw token
		tfaTokenRecord, err := homeDB.GetOrgTFAToken(ctx, rawTFAToken)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("invalid or expired TFA token")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			s.Logger(ctx).Error("failed to query TFA token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify TFA code
		if tfaTokenRecord.TfaCode != string(tfaRequest.TFACode) {
			s.Logger(ctx).Debug("invalid TFA code")
			w.WriteHeader(http.StatusForbidden)
			return
		}

		// NOTE: We intentionally do NOT delete the TFA token here (same as hub).
		// Token expires naturally, and reusing it just creates another session.

		// Get org user from regional database to get preferred language
		regionalUser, err := homeDB.GetOrgUserByID(ctx, tfaTokenRecord.OrgUserID)
		if err != nil {
			s.Logger(ctx).Error("failed to fetch regional org user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get org to return org_name in response
		org, err := s.Global.GetOrgByID(ctx, regionalUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to fetch org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate session token
		sessionTokenBytes := make([]byte, 32)
		if _, err := rand.Read(sessionTokenBytes); err != nil {
			s.Logger(ctx).Error("failed to generate session token", "error", err)
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
		expiresAt := pgtype.Timestamptz{Time: time.Now().Add(sessionExpiry), Valid: true}
		err = s.WithRegionalTxFor(ctx, region, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.CreateOrgSession(ctx, regionaldb.CreateOrgSessionParams{
				SessionToken: rawSessionToken,
				OrgUserID:    tfaTokenRecord.OrgUserID,
				ExpiresAt:    expiresAt,
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.login",
				ActorUserID: regionalUser.OrgUserID,
				OrgID:       regionalUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte("{}"),
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to store session", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("org user TFA verified, session created", "org_user_id", regionalUser.OrgUserID, "region", region, "remember_me", tfaRequest.RememberMe)

		response := orgtypes.OrgTFAResponse{
			SessionToken:      orgtypes.OrgSessionToken(sessionToken),
			PreferredLanguage: common.LanguageCode(regionalUser.PreferredLanguage),
			OrgName:           org.OrgName,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}
