package credentials

import (
	"regexp"
	"testing"
)

func TestVerificationCodeFormat(t *testing.T) {
	pattern := regexp.MustCompile(`^[0-9]{6}$`)
	for range 100 {
		code, err := NewVerificationCode()
		if err != nil {
			t.Fatal(err)
		}
		if !pattern.MatchString(code) {
			t.Fatalf("invalid code format: %q", code)
		}
	}
}

func TestVerificationCodeHashBoundToChallenge(t *testing.T) {
	key := [32]byte{1, 2, 3}
	const first = "01000000-0000-0000-0000-000000000000"
	const second = "02000000-0000-0000-0000-000000000000"
	baseline := VerificationCodeHash(key, first, "123456")
	if len(baseline) != 32 {
		t.Fatalf("hash size = %d", len(baseline))
	}
	if string(baseline) != string(VerificationCodeHash(key, first, "123456")) {
		t.Fatal("same challenge and code yielded different hashes")
	}
	if string(baseline) == string(VerificationCodeHash(key, first, "123457")) {
		t.Fatal("changing the code did not change the hash")
	}
	if string(baseline) == string(VerificationCodeHash(key, second, "123456")) {
		t.Fatal("changing the challenge did not change the hash")
	}
	if string(baseline) == string(
		VerificationCodeHash([32]byte{9}, first, "123456"),
	) {
		t.Fatal("changing the key did not change the hash")
	}
}
