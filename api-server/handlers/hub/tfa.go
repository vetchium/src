package hub

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
	"vetchium-api-server.typespec/hub"
)

func TFA(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var tfaRequest hub.HubTFARequest
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

		// Query the specific regional database using raw token
		tfaTokenRecord, err := homeDB.GetHubTFAToken(ctx, rawTFAToken)
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

		// Get hub user from home region's database to get preferred language
		regionalUser, err := homeDB.GetHubUserByGlobalID(ctx, tfaTokenRecord.HubUserGlobalID)
		if err != nil {
			s.Logger(ctx).Error("failed to fetch regional hub user", "error", err)
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
			sessionExpiry = s.TokenConfig.HubRememberMeExpiry
		} else {
			sessionExpiry = s.TokenConfig.HubSessionTokenExpiry
		}

		// Store session and write audit log atomically
		expiresAt := pgtype.Timestamptz{Time: time.Now().Add(sessionExpiry), Valid: true}
		err = s.WithRegionalTxFor(ctx, region, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.CreateHubSession(ctx, regionaldb.CreateHubSessionParams{
				SessionToken:    rawSessionToken,
				HubUserGlobalID: tfaTokenRecord.HubUserGlobalID,
				ExpiresAt:       expiresAt,
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.login",
				ActorUserID: regionalUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte("{}"),
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to store session", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("hub user TFA verified, session created", "hub_user_global_id", regionalUser.HubUserGlobalID, "region", region, "remember_me", tfaRequest.RememberMe)

		response := hub.HubTFAResponse{
			SessionToken:      hub.HubSessionToken(sessionToken),
			PreferredLanguage: common.LanguageCode(regionalUser.PreferredLanguage),
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}
