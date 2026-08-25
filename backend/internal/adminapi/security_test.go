package adminapi

import (
	"bytes"
	"encoding/hex"
	"strings"
	"testing"
)

func TestNewTokenUsesLowercaseHexAndMatchingDigest(t *testing.T) {
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

func TestCredentialEncryptionIsVersionedAndPurposeSeparated(t *testing.T) {
	root := DeriveCredentialKey("sgp", "deployment-secret")
	outboxKey := DeriveCredentialSubkey(root, "outbox")
	totpKey := DeriveCredentialSubkey(root, "totp")
	if outboxKey == totpKey {
		t.Fatal("purpose-specific credential subkeys are equal")
	}

	ciphertext, err := Encrypt(outboxKey, []byte("credential"))
	if err != nil {
		t.Fatal(err)
	}
	if ciphertext[0] != credentialCipherVersion {
		t.Fatalf("ciphertext version = %d, want %d", ciphertext[0], credentialCipherVersion)
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

func TestCredentialDecryptionRejectsUnknownVersion(t *testing.T) {
	key := DeriveCredentialKey("sgp", "deployment-secret")
	ciphertext, err := Encrypt(key, []byte("credential"))
	if err != nil {
		t.Fatal(err)
	}
	ciphertext[0]++
	if _, err := Decrypt(key, ciphertext); err == nil {
		t.Fatal("Decrypt() with an unknown version succeeded")
	}
}
