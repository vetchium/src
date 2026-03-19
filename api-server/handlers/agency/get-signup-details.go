package agency

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/agency"
	"vetchium-api-server.typespec/common"
)

func GetSignupDetails(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		var req agency.AgencyGetSignupDetailsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Look up pending signup by email_token
		tokenRecord, err := s.Global.GetAgencySignupTokenByEmailToken(ctx, string(req.SignupToken))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("no pending signup found for token")
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to query signup token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Return only the domain, not the DNS verification token
		response := agency.AgencyGetSignupDetailsResponse{
			Domain: common.DomainName(tokenRecord.Domain),
		}

		s.Logger(ctx).Info("signup details retrieved", "domain", tokenRecord.Domain)
		json.NewEncoder(w).Encode(response)
	}
}
