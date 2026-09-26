package regions

import (
	"net/http"

	"github.com/vetchium/src/typespec/problem"
	regionspec "github.com/vetchium/src/typespec/regions"

	"backend/internal/apiserver"
	regionpolicy "backend/internal/regions"
)

// OrgHandler serves Org signup discovery from the tenant's bundled catalog
// only. Every tenant ships the same catalog, so a live directory would add an
// outage mode without changing the answer, and Org signup admission is
// decided by the destination tenant anyway.
func OrgHandler(
	runtime *apiserver.Runtime, catalog *regionpolicy.Catalog,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request regionspec.ListOrgSignupRegionsRequest
		if !apiserver.Decode(runtime, w, r, &request) {
			return
		}
		response, err := catalog.ListOrgs(request)
		if err != nil {
			// A well-formed cursor from an older catalog cannot be continued
			// either; the caller restarts from the first page.
			runtime.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		runtime.JSON(r.Context(), w, http.StatusOK, response)
	}
}
