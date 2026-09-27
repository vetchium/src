package orgmail

import (
	"testing"
	"time"
)

func TestPayloadRoundTripRequiresTheKey(t *testing.T) {
	t.Parallel()
	key := [32]byte{1}
	payload := Payload{
		Domain: "example.com", ActionURL: "https://orgs.example/x",
		ExpiresAt: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
	}
	ciphertext, err := Encrypt(key, payload)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := Decrypt(key, ciphertext)
	if err != nil || decoded != payload {
		t.Fatalf("decoded = %+v, err = %v", decoded, err)
	}
	if _, err := Decrypt([32]byte{2}, ciphertext); err == nil {
		t.Fatal("payload decrypted with another key")
	}
}
