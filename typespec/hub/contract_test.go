package hub

import "testing"

func TestHubIdentifiers(t *testing.T) {
	t.Parallel()
	if !IsHubUserDID("018f7e32-7b5a-7d31-8fd0-f7e2a852f144") {
		t.Fatal("valid UUIDv7 DID rejected")
	}
	if IsHubUserDID("018f7e32-7b5a-4d31-8fd0-f7e2a852f144") {
		t.Fatal("UUIDv4 accepted as Hub DID")
	}
	if !IsHubHandle("perso-00000000001") {
		t.Fatal("valid handle rejected")
	}
	if IsHubHandle("person-00000000001") {
		t.Fatal("variable-width handle accepted")
	}
}
