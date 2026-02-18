package agency

import (
	"crypto/rand"
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
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	agencydomains "vetchium-api-server.typespec/agency-domains"
)

func ClaimDomain(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		agencyUser := middleware.AgencyUserFromContext(ctx)
		if agencyUser == nil {
			log.Debug("agency user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req agencydomains.AgencyClaimDomainRequest
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

		// Normalize domain to lowercase
		domain := strings.ToLower(string(req.Domain))

		// Check if domain is already claimed in global DB
		_, err := s.Global.GetGlobalAgencyDomain(ctx, domain)
		if err == nil {
			log.Debug("domain already claimed", "domain", domain)
			w.WriteHeader(http.StatusConflict)
			return
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to check global domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate verification token
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			log.Error("failed to generate verification token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		verificationToken := hex.EncodeToString(tokenBytes)

		// Calculate token expiry
		tokenExpiresAt := time.Now().AddDate(0, 0, agencydomains.AgencyTokenExpiryDays)

		// SAGA pattern: Create in global DB first (for uniqueness)
		err = s.Global.CreateGlobalAgencyDomain(ctx, globaldb.CreateGlobalAgencyDomainParams{
			Domain:   domain,
			Region:   s.CurrentRegion,
			AgencyID: agencyUser.AgencyID,
		})
		if err != nil {
			// Check for unique constraint violation (domain already claimed)
			if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
				log.Debug("domain already claimed (race condition)", "domain", domain)
				w.WriteHeader(http.StatusConflict)
				return
			}
			log.Error("failed to create global agency domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Create in regional DB
		err = s.Regional.CreateAgencyDomain(ctx, regionaldb.CreateAgencyDomainParams{
			Domain:            domain,
			AgencyID:          agencyUser.AgencyID,
			VerificationToken: verificationToken,
			TokenExpiresAt:    pgtype.Timestamp{Time: tokenExpiresAt, Valid: true},
			Status:            regionaldb.DomainVerificationStatusPENDING,
		})
		if err != nil {
			log.Error("failed to create regional agency domain", "error", err)
			// Compensating transaction: delete from global DB
			if delErr := s.Global.DeleteGlobalAgencyDomain(ctx, domain); delErr != nil {
				log.Error("CONSISTENCY_ALERT: failed to rollback global agency domain", "error", delErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("domain claimed", "domain", domain, "agency_id", agencyUser.AgencyID)

		// Build DNS instructions
		instructions := fmt.Sprintf(
			"Add a TXT record to your DNS with the following values:\n"+
				"Host: _vetchium-verify.%s\n"+
				"Value: %s\n\n"+
				"This token will expire in %d days.",
			domain, verificationToken, agencydomains.AgencyTokenExpiryDays,
		)

		w.WriteHeader(http.StatusCreated)
		response := agencydomains.AgencyClaimDomainResponse{
			Domain:            domain,
			VerificationToken: agencydomains.AgencyDomainVerificationToken(verificationToken),
			ExpiresAt:         tokenExpiresAt,
			Instructions:      instructions,
		}
		json.NewEncoder(w).Encode(response)
	}
}
