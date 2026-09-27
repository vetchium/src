package identitydigest

import (
	"encoding/hex"
	"testing"
)

// TestFixedVectors pins the digest and key id formulas against
// independently computed values (see GU-KEY-003, GU-KEY-004), so a change to
// the HMAC construction, domain separation strings, or key derivation is
// caught even though every tenant must keep producing byte-identical output.
func TestFixedVectors(t *testing.T) {
	key := NewKey("test_identity_digest_key")

	wantAccount := "bee57e69a23d800d7718d0e79b2be1519e131232967431dba85e2737b6621f6e"
	if got := hex.EncodeToString(
		key.HubAccountEmail("  A@B.Example "),
	); got != wantAccount {
		t.Fatalf("HubAccountEmail() = %s, want %s", got, wantAccount)
	}

	wantProfessional := "12dfcc45f137e21bf90fc04de82e18e858cc496e1b1c43d4cad69a81a7e0180d"
	if got := hex.EncodeToString(
		key.HubProfessionalEmail("  A@B.Example "),
	); got != wantProfessional {
		t.Fatalf("HubProfessionalEmail() = %s, want %s", got, wantProfessional)
	}

	wantID := "a17b74020aa051b7"
	if got := key.ID(); got != wantID {
		t.Fatalf("ID() = %s, want %s", got, wantID)
	}
}

func TestNamespaceSeparation(t *testing.T) {
	key := NewKey("some-secret")
	account := key.HubAccountEmail("same@example.com")
	professional := key.HubProfessionalEmail("same@example.com")
	if hex.EncodeToString(account) == hex.EncodeToString(professional) {
		t.Fatal(
			"HubAccountEmail and HubProfessionalEmail produced the same " +
				"digest for the same address; the global directory could " +
				"correlate a user's account and work addresses",
		)
	}
}

func TestNormalize(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"  A@B.Example ", "a@b.example"},
		{"already@lower.com", "already@lower.com"},
		{"\tTAB@EXAMPLE.COM", "\ttab@example.com"},
	}
	for _, test := range tests {
		if got := Normalize(test.input); got != test.want {
			t.Errorf("Normalize(%q) = %q, want %q", test.input, got, test.want)
		}
	}
}

// TestKeyDeterminism confirms two Key values built from the same secret
// string always agree, since every tenant computes digests independently
// from the same shared secret and must land on the same global claim row.
func TestKeyDeterminism(t *testing.T) {
	a := NewKey("shared-secret")
	b := NewKey("shared-secret")
	if hex.EncodeToString(a.HubAccountEmail("x@example.com")) !=
		hex.EncodeToString(b.HubAccountEmail("x@example.com")) {
		t.Fatal("two keys built from the same secret produced different digests")
	}
	if a.ID() != b.ID() {
		t.Fatal("two keys built from the same secret produced different ids")
	}

	c := NewKey("different-secret")
	if a.ID() == c.ID() {
		t.Fatal("keys built from different secrets produced the same id")
	}
}

func TestKeyIDRevealsNothingObvious(t *testing.T) {
	key := NewKey("dev_identity_digest_key")
	id := key.ID()
	if len(id) != 16 {
		t.Fatalf("ID() length = %d, want 16 hex characters (8 bytes)", len(id))
	}
	if _, err := hex.DecodeString(id); err != nil {
		t.Fatalf("ID() = %q is not lowercase hex: %v", id, err)
	}
}
