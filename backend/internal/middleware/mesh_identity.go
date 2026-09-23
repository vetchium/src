package middleware

import (
	"net/http"
	"net/url"
	"strings"

	directoryspec "github.com/vetchium/src/typespec/directory"

	"backend/internal/meshidentity"
)

const meshTrustDomain = "mesh.vetchium.com"

// MeshIdentity records a tenant only when the TLS stack verified a client
// chain containing that tenant's canonical URI SAN. Authorization remains the
// responsibility of the receiving handler.
func MeshIdentity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tenantID, ok := verifiedMeshTenant(r)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(
			w, r.WithContext(meshidentity.WithTenant(r.Context(), tenantID)),
		)
	})
}

func verifiedMeshTenant(r *http.Request) (directoryspec.TenantID, bool) {
	if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 {
		return "", false
	}
	identities := r.TLS.VerifiedChains[0][0].URIs
	if len(identities) != 1 {
		return "", false
	}
	return tenantFromMeshURI(identities[0])
}

func tenantFromMeshURI(uri *url.URL) (directoryspec.TenantID, bool) {
	if uri == nil || uri.Scheme != "spiffe" || uri.Host != meshTrustDomain ||
		uri.RawQuery != "" || uri.Fragment != "" {
		return "", false
	}
	parts := strings.Split(strings.Trim(uri.EscapedPath(), "/"), "/")
	if len(parts) != 3 || parts[0] != "tenant" || parts[2] != "mesh-api" {
		return "", false
	}
	value, err := url.PathUnescape(parts[1])
	if err != nil {
		return "", false
	}
	tenantID := directoryspec.TenantID(value)
	return tenantID, directoryspec.IsTenantID(tenantID)
}
