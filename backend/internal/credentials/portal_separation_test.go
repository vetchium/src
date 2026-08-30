// This file lives with the shared package rather than with either portal so
// that no portal package has to import another one to assert the invariant.
package credentials_test

import (
	"testing"

	adminauthn "backend/internal/admin/auth"
	hubauthn "backend/internal/hub/auth"
)

// One deployment secret serves every portal in a tenant, so no two portals may
// derive the same credential key or subkey from it.
func TestPortalCredentialKeysDoNotCollide(t *testing.T) {
	t.Parallel()
	const tenantID = "sgp"
	const secret = "deployment-secret"
	keys := map[string][32]byte{
		"admin": adminauthn.DeriveCredentialKey(tenantID, secret),
		"hub":   hubauthn.DeriveCredentialKey(tenantID, secret),
	}
	seen := make(map[[32]byte]string, len(keys))
	for portal, key := range keys {
		if other, ok := seen[key]; ok {
			t.Fatalf("%s and %s derive the same credential key", portal, other)
		}
		seen[key] = portal
	}

	root := keys["admin"]
	subkeys := map[string][32]byte{
		"admin": adminauthn.DeriveCredentialSubkey(root, "totp"),
		"hub":   hubauthn.DeriveCredentialSubkey(root, "totp"),
	}
	seenSubkeys := make(map[[32]byte]string, len(subkeys))
	for portal, subkey := range subkeys {
		if other, ok := seenSubkeys[subkey]; ok {
			t.Fatalf(
				"%s and %s derive the same credential subkey", portal, other,
			)
		}
		seenSubkeys[subkey] = portal
	}
}
