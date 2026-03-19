package agency

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
	"vetchium-api-server.gomodule/internal/proxy"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/agency"
	"vetchium-api-server.typespec/common"
)

func TFA(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
			return
		}

		var tfaRequest agency.AgencyTFARequest
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

		// Proxy to correct region if needed
		if region != s.CurrentRegion {
			s.ProxyToRegion(w, r, region, bodyBytes)
			return
		}

		// Query the specific regional database using raw token
		tfaTokenRecord, err := s.Regional.GetAgencyTFAToken(ctx, rawTFAToken)
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

		// NOTE: We intentionally do NOT delete the TFA token here (same as hub and org).
		// Token expires naturally, and reusing it just creates another session.

		// Get agency user from regional database to get preferred language
		regionalUser, err := s.Regional.GetAgencyUserByID(ctx, tfaTokenRecord.AgencyUserID)
		if err != nil {
			s.Logger(ctx).Error("failed to fetch regional agency user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get agency to return agency_name in response
		agencyEntity, err := s.Global.GetAgencyByID(ctx, regionalUser.AgencyID)
		if err != nil {
			s.Logger(ctx).Error("failed to fetch agency", "error", err)
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
			sessionExpiry = s.TokenConfig.AgencyRememberMeExpiry
		} else {
			sessionExpiry = s.TokenConfig.AgencySessionTokenExpiry
		}

		// Store session in regional database (raw token without prefix)
		expiresAt := pgtype.Timestamptz{Time: time.Now().Add(sessionExpiry), Valid: true}
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.CreateAgencySession(ctx, regionaldb.CreateAgencySessionParams{
				SessionToken: rawSessionToken,
				AgencyUserID: tfaTokenRecord.AgencyUserID,
				ExpiresAt:    expiresAt,
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "agency.login",
				ActorUserID: regionalUser.AgencyUserID,
				OrgID:       regionalUser.AgencyID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte("{}"),
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to store session", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("agency user TFA verified, session created", "agency_user_id", regionalUser.AgencyUserID, "region", region, "remember_me", tfaRequest.RememberMe)

		response := agency.AgencyTFAResponse{
			SessionToken:      agency.AgencySessionToken(sessionToken),
			PreferredLanguage: common.LanguageCode(regionalUser.PreferredLanguage),
			AgencyName:        agencyEntity.AgencyName,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}
