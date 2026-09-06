package regions

import (
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"

	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	regionsproblem "github.com/vetchium/src/typespec/problem/regions"
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
		degraded := false
		if directory != nil {
			response, err := directory.ListSignupRegions(r.Context(), request)
			if err == nil {
				runtime.JSON(r.Context(), w, http.StatusOK, response)
				return
			}
			if errors.Is(err, regionpolicy.ErrRequestRejected) {
				runtime.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			degraded = true
			runtime.WarnContext(r.Context(), "region discovery unavailable; using local catalog", "event", "region_discovery_fallback")
		}
		response, err := catalog.List(request)
		if err != nil {
			// A cursor the directory issued is bound to the directory's own
			// catalog, so the bundled one cannot continue it. During an outage
			// that is a server-side fault. A cursor that is malformed, or bound
			// to another country, stays the caller's error either way.
			if degraded && errors.Is(err, regionpolicy.ErrForeignCursor) {
				runtime.Problem(
					r.Context(), w,
					regionsproblem.RegionDiscoveryUnavailableError,
				)
				return
			}
			runtime.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
			return
		}
		runtime.JSON(r.Context(), w, http.StatusOK, response)
	}
}
