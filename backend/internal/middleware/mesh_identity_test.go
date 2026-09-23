package middleware

import (
	"crypto/tls"
	"crypto/x509"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"backend/internal/meshidentity"
)

func TestMeshIdentity(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name, uri, want string
		verified        bool
	}{
		{
			name: "verified tenant", verified: true,
			uri:  "spiffe://mesh.vetchium.com/tenant/ind1/mesh-api",
			want: "ind1",
		},
		{
			name: "unverified chain", verified: false,
			uri: "spiffe://mesh.vetchium.com/tenant/ind1/mesh-api",
		},
		{
			name: "wrong trust domain", verified: true,
			uri: "spiffe://attacker.example/tenant/ind1/mesh-api",
		},
		{
			name: "wrong workload", verified: true,
			uri: "spiffe://mesh.vetchium.com/tenant/ind1/hub-api",
		},
		{
			name: "invalid tenant", verified: true,
			uri: "spiffe://mesh.vetchium.com/tenant/IN/mesh-api",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			parsed, err := url.Parse(test.uri)
			if err != nil {
				t.Fatal(err)
			}
			certificate := &x509.Certificate{URIs: []*url.URL{parsed}}
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.TLS = &tls.ConnectionState{}
			if test.verified {
				request.TLS.VerifiedChains = [][]*x509.Certificate{{certificate}}
			}
			var got string
			next := http.HandlerFunc(func(
				_ http.ResponseWriter, r *http.Request,
			) {
				if tenantID, ok := meshidentity.TenantFromContext(
					r.Context(),
				); ok {
					got = string(tenantID)
				}
			})
			MeshIdentity(next).ServeHTTP(httptest.NewRecorder(), request)
			if got != test.want {
				t.Fatalf("tenant = %q, want %q", got, test.want)
			}
		})
	}
}

func TestMeshIdentityRejectsAmbiguousCertificate(t *testing.T) {
	t.Parallel()
	first, _ := url.Parse(
		"spiffe://mesh.vetchium.com/tenant/ind1/mesh-api",
	)
	second, _ := url.Parse(
		"spiffe://mesh.vetchium.com/tenant/sgp/mesh-api",
	)
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.TLS = &tls.ConnectionState{VerifiedChains: [][]*x509.Certificate{{
		{URIs: []*url.URL{first, second}},
	}}}
	calledWithIdentity := false
	MeshIdentity(http.HandlerFunc(func(
		_ http.ResponseWriter, r *http.Request,
	) {
		_, calledWithIdentity = meshidentity.TenantFromContext(r.Context())
	})).ServeHTTP(httptest.NewRecorder(), request)
	if calledWithIdentity {
		t.Fatal("ambiguous certificate populated a tenant identity")
	}
}

func TestMeshIdentityRejectsAdditionalURIIdentity(t *testing.T) {
	t.Parallel()
	tenant, _ := url.Parse(
		"spiffe://mesh.vetchium.com/tenant/ind1/mesh-api",
	)
	extra, _ := url.Parse("spiffe://mesh.vetchium.com/system/monitor")
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.TLS = &tls.ConnectionState{VerifiedChains: [][]*x509.Certificate{{
		{URIs: []*url.URL{tenant, extra}},
	}}}
	calledWithIdentity := false
	MeshIdentity(http.HandlerFunc(func(
		_ http.ResponseWriter, r *http.Request,
	) {
		_, calledWithIdentity = meshidentity.TenantFromContext(r.Context())
	})).ServeHTTP(httptest.NewRecorder(), request)
	if calledWithIdentity {
		t.Fatal("certificate with an additional URI populated a tenant identity")
	}
}
