package credentials

import (
	"bytes"
	"encoding/hex"
	"strings"
	"testing"
)

func TestNewTokenUsesLowercaseHexAndMatchingDigest(t *testing.T) {
	t.Parallel()
	token, digest, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(token) != 64 || token != strings.ToLower(token) {
		t.Fatalf("token = %q, want 64 lowercase hexadecimal characters", token)
	}
	decoded, err := hex.DecodeString(token)
	if err != nil {
		t.Fatalf("token is not hexadecimal: %v", err)
	}
	if len(decoded) != 32 {
		t.Fatalf("decoded token length = %d, want 32", len(decoded))
	}
	if !bytes.Equal(digest, TokenHash(token)) {
		t.Fatal("returned token digest does not match TokenHash")
	}
}

func TestDeriveKeySeparatesDomainsAndTenants(t *testing.T) {
	t.Parallel()
	admin := DeriveKey("vetchium-admin-credentials", "sgp", "secret")
	hub := DeriveKey("vetchium-hub-credentials", "sgp", "secret")
	if admin == hub {
		t.Fatal("two portal domains derived the same key")
	}
	if admin == DeriveKey("vetchium-admin-credentials", "deu", "secret") {
		t.Fatal("tenant did not affect the derived key")
	}
	if admin == DeriveKey("vetchium-admin-credentials", "sgp", "other") {
		t.Fatal("deployment secret did not affect the derived key")
	}
}

func TestDeriveSubkeySeparatesDomainsAndPurposes(t *testing.T) {
	t.Parallel()
	root := DeriveKey("vetchium-admin-credentials", "sgp", "secret")
	totp := DeriveSubkey("vetchium-admin-subkey", root, "totp")
	if totp == DeriveSubkey("vetchium-admin-subkey", root, "outbox") {
		t.Fatal("purpose did not affect the derived subkey")
	}
	if totp == DeriveSubkey("vetchium-hub-subkey", root, "totp") {
		t.Fatal("domain did not affect the derived subkey")
	}
}

func TestEncryptionIsVersionedAndKeyBound(t *testing.T) {
	t.Parallel()
	root := DeriveKey("vetchium-admin-credentials", "sgp", "deployment-secret")
	outboxKey := DeriveSubkey("vetchium-admin-subkey", root, "outbox")
	totpKey := DeriveSubkey("vetchium-admin-subkey", root, "totp")

	ciphertext, err := Encrypt(outboxKey, []byte("credential"))
	if err != nil {
		t.Fatal(err)
	}
	if ciphertext[0] != cipherVersion {
		t.Fatalf(
			"ciphertext version = %d, want %d", ciphertext[0], cipherVersion,
		)
	}
	plaintext, err := Decrypt(outboxKey, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(plaintext, []byte("credential")) {
		t.Fatalf("plaintext = %q, want credential", plaintext)
	}
	if _, err := Decrypt(totpKey, ciphertext); err == nil {
		t.Fatal("Decrypt() with a different-purpose subkey succeeded")
	}
}

func TestDecryptRejectsUnknownVersionAndTruncation(t *testing.T) {
	t.Parallel()
	key := DeriveKey("vetchium-admin-credentials", "sgp", "deployment-secret")
	ciphertext, err := Encrypt(key, []byte("credential"))
	if err != nil {
		t.Fatal(err)
	}
	unknown := bytes.Clone(ciphertext)
	unknown[0]++
	if _, err := Decrypt(key, unknown); err == nil {
		t.Fatal("Decrypt() with an unknown version succeeded")
	}
	if _, err := Decrypt(key, ciphertext[:8]); err == nil {
		t.Fatal("Decrypt() with a truncated ciphertext succeeded")
	}
}

func TestSignedValueIsPurposeAndKeyBound(t *testing.T) {
	t.Parallel()
	key := DeriveKey("vetchium-admin-credentials", "sgp", "secret")
	other := DeriveKey("vetchium-admin-credentials", "deu", "secret")
	payload := []byte(`{"page":2}`)
	signed := SignValue(key, "pagination", payload)

	got, ok := VerifySignedValue(key, "pagination", signed)
	if !ok || !bytes.Equal(got, payload) {
		t.Fatalf("VerifySignedValue() = %q, %t", got, ok)
	}
	if _, ok := VerifySignedValue(key, "other-purpose", signed); ok {
		t.Fatal("a value signed for one purpose verified for another")
	}
	if _, ok := VerifySignedValue(other, "pagination", signed); ok {
		t.Fatal("a value signed with one key verified with another")
	}
	for _, malformed := range []string{"", "no-separator", signed + ".extra"} {
		if _, ok := VerifySignedValue(key, "pagination", malformed); ok {
			t.Fatalf("malformed value %q verified", malformed)
		}
	}
	if _, ok := VerifySignedValue(
		key, "pagination", "not*base64."+strings.SplitN(signed, ".", 2)[1],
	); ok {
		t.Fatal("a value with an undecodable payload verified")
	}
}

func TestPasswordHashingRoundTrips(t *testing.T) {
	t.Parallel()
	// bcrypt truncates at 72 bytes, so a longer password must still depend on
	// every byte through the pre-hash.
	long := strings.Repeat("a", 80)
	hash, err := HashPassword(long)
	if err != nil {
		t.Fatal(err)
	}
	if err := ComparePassword(hash, long); err != nil {
		t.Fatalf("ComparePassword() = %v", err)
	}
	if err := ComparePassword(hash, long+"b"); err == nil {
		t.Fatal("ComparePassword() accepted a different long password")
	}
}
