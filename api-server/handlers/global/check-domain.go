package global

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/global"
)

func CheckDomain(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		var req global.CheckDomainRequest
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

		_, err := s.Global.GetActiveDomainByName(ctx, string(req.Domain))
		isApproved := false
		if err == nil {
			isApproved = true
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to query domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		response := global.CheckDomainResponse{
			IsApproved: isApproved,
		}

		json.NewEncoder(w).Encode(response)
	}
}
