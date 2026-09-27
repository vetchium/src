package auth

import "testing"

func TestCredentialKeysAreTenantAndPurposeBound(t *testing.T) {
	t.Parallel()
	root := DeriveCredentialKey("sgp", "secret")
	if root == DeriveCredentialKey("deu", "secret") {
		t.Fatal("tenant did not affect credential key")
	}
	if DeriveCredentialSubkey(root, "totp") ==
		DeriveCredentialSubkey(root, "outbox") {
		t.Fatal("purpose did not affect credential subkey")
	}
}
