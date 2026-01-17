package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/common"
	"vetchium-api-server.typespec/org"
)

func GetSignupDetails(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		var req org.OrgGetSignupDetailsRequest
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

		// Look up pending signup by email_token
		tokenRecord, err := s.Global.GetOrgSignupTokenByEmailToken(ctx, string(req.SignupToken))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("no pending signup found for token")
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to query signup token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Return only the domain, not the DNS verification token
		response := org.OrgGetSignupDetailsResponse{
			Domain: common.DomainName(tokenRecord.Domain),
		}

		log.Info("signup details retrieved", "domain", tokenRecord.Domain)
		json.NewEncoder(w).Encode(response)
	}
}
