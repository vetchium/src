package regions

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	regionspec "github.com/vetchium/src/typespec/regions"

	"backend/internal/apiserver"
	regionpolicy "backend/internal/regions"
)

// Handler uses a bundled catalog when discovery is unavailable. Admission is
// always checked against the receiving tenant's own configuration.
func Handler(runtime *apiserver.Runtime, catalog *regionpolicy.Catalog, directory regionpolicy.Directory, credential string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if credential != "" {
			scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
			got, want := sha256.Sum256([]byte(token)), sha256.Sum256([]byte(credential))
			if !ok || !strings.EqualFold(scheme, "Bearer") || subtle.ConstantTimeCompare(got[:], want[:]) != 1 {
				runtime.AuthenticationProblem(r.Context(), w, coordinatorproblem.AuthenticationRequiredError, `Bearer realm="global-coordinator"`)
				return
			}
		}
		var request regionspec.ListSignupRegionsRequest
		if !apiserver.Decode(runtime, w, r, &request) {
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if directory != nil {
			response, err := directory.ListSignupRegions(r.Context(), request)
			if err == nil {
				runtime.JSON(r.Context(), w, http.StatusOK, response)
				return
			}
			runtime.WarnContext(r.Context(), "region discovery unavailable; using local catalog", "event", "region_discovery_fallback")
		}
		response, err := catalog.List(request)
		if err != nil {
			runtime.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
			return
		}
		runtime.JSON(r.Context(), w, http.StatusOK, response)
	}
}
