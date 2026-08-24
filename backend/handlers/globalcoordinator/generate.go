package globalcoordinator

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"strings"

	coordinatorspec "github.com/vetchium/src/typespec/global-coordinator"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/globalcoordinator"
)

const authenticationChallenge = `Bearer realm="global-coordinator"`

func GenerateShortID(s *globalcoordinator.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticated(r.Header.Get("Authorization"), s.Credential) {
			s.Problem(
				r.Context(), w,
				coordinatorproblem.AuthenticationRequiredError,
				authenticationChallenge,
			)
			return
		}
		shortID, err := s.Generator.Generate()
		if err != nil {
			s.InternalError(r.Context(), w, "generate short ID", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusCreated,
			coordinatorspec.GenerateShortIDResponse{ShortID: shortID},
		)
	}
}

func authenticated(authorization, credential string) bool {
	scheme, token, found := strings.Cut(authorization, " ")
	if !found || !strings.EqualFold(scheme, "Bearer") || token == "" {
		return false
	}
	suppliedHash := sha256.Sum256([]byte(token))
	expectedHash := sha256.Sum256([]byte(credential))
	return subtle.ConstantTimeCompare(suppliedHash[:], expectedHash[:]) == 1
}
