package auth

import "testing"

func TestCredentialKeysAreTenantAndPurposeBound(t *testing.T) {
	t.Parallel()
	root := DeriveCredentialKey("sgp", "deployment-secret")
	if root == DeriveCredentialKey("deu", "deployment-secret") {
		t.Fatal("tenant did not affect the credential key")
	}
	if DeriveCredentialSubkey(root, "totp") ==
		DeriveCredentialSubkey(root, "outbox") {
		t.Fatal("purpose did not affect the credential subkey")
	}
}
