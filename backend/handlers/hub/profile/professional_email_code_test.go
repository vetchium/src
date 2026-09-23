package profile

import (
	"regexp"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestProfessionalEmailCodeFormat(t *testing.T) {
	pattern := regexp.MustCompile(`^[0-9]{6}$`)
	for range 100 {
		code, err := newProfessionalCode()
		if err != nil {
			t.Fatal(err)
		}
		if !pattern.MatchString(code) {
			t.Fatalf("invalid code format: %q", code)
		}
	}
}

func TestProfessionalEmailCodeHashBoundToChallenge(t *testing.T) {
	key := [32]byte{1, 2, 3}
	first := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	second := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	baseline := professionalCodeHash(key, first, "123456")
	if len(baseline) != 32 {
		t.Fatalf("hash size = %d", len(baseline))
	}
	if string(baseline) != string(professionalCodeHash(key, first, "123456")) {
		t.Fatal("same challenge and code yielded different hashes")
	}
	if string(baseline) == string(professionalCodeHash(key, first, "123457")) {
		t.Fatal("changing the code did not change the hash")
	}
	if string(baseline) == string(professionalCodeHash(key, second, "123456")) {
		t.Fatal("changing the challenge did not change the hash")
	}
}
