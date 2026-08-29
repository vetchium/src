package credentials

import (
	"testing"
	"time"
)

func TestVerifyTOTPAcceptsAdjacentStepsOnly(t *testing.T) {
	t.Parallel()
	secret, err := NewTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0).UTC()
	step := now.Unix() / 30
	for _, test := range []struct {
		name   string
		offset int64
		want   bool
	}{
		{"current step", 0, true},
		{"previous step", -1, true},
		{"next step", 1, true},
		{"two steps early", -2, false},
		{"two steps late", 2, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			code := totpCodeForTest(t, secret, step+test.offset)
			gotStep, ok := VerifyTOTP(secret, code, now)
			if ok != test.want {
				t.Fatalf("VerifyTOTP() accepted = %t, want %t", ok, test.want)
			}
			if ok && gotStep != step+test.offset {
				t.Fatalf(
					"accepted step = %d, want %d", gotStep, step+test.offset,
				)
			}
		})
	}
}

func TestVerifyTOTPRejectsEmptyAndUndecodableSecrets(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_800_000_000, 0).UTC()
	// An undecodable secret yields an empty code, which must not then match an
	// empty submitted code.
	if _, ok := VerifyTOTP("not base32!", "", now); ok {
		t.Fatal("VerifyTOTP() accepted an empty code for a broken secret")
	}
}

func TestNewRecoveryCodesAreFormattedAndHashed(t *testing.T) {
	t.Parallel()
	codes, hashes, err := NewRecoveryCodes()
	if err != nil {
		t.Fatal(err)
	}
	if len(codes) != 10 || len(hashes) != 10 {
		t.Fatalf("got %d codes and %d hashes, want 10 each",
			len(codes), len(hashes))
	}
	seen := make(map[string]bool, len(codes))
	for index, code := range codes {
		if len(code) != 23 {
			t.Fatalf("code %q length = %d, want 23", code, len(code))
		}
		if seen[code] {
			t.Fatalf("duplicate recovery code %q", code)
		}
		seen[code] = true
		if string(hashes[index]) != string(RecoveryCodeHash(code)) {
			t.Fatalf("hash %d does not match RecoveryCodeHash", index)
		}
		// Users retype recovery codes, so surrounding space and case must not
		// change the hash.
		if string(RecoveryCodeHash("  "+code+"  ")) !=
			string(RecoveryCodeHash(code)) {
			t.Fatalf("RecoveryCodeHash did not normalize %q", code)
		}
	}
}

func totpCodeForTest(t *testing.T, secret string, step int64) string {
	t.Helper()
	key, err := totpEncoding.DecodeString(secret)
	if err != nil {
		t.Fatal(err)
	}
	return totpCode(key, step)
}
