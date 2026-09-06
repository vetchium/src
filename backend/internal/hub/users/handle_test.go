package users

import (
	"strings"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/hub"

	"backend/internal/dbvalue"
)

func TestGeneratedIdentifierIsAHubUserDID(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.August, 24, 12, 0, 0, 0, time.UTC)
	value, err := dbvalue.NewUUIDv7(now)
	if err != nil {
		t.Fatal(err)
	}
	if !hub.IsHubUserDID(hub.HubUserDID(value.String())) {
		t.Fatalf("generated DID = %q, want UUIDv7", value.String())
	}
}

func TestHandle(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		displayName string
		wantPrefix  string
	}{
		{"ASCII", "Grace Hopper", "grace-"},
		{"padding", "Li", "lixxx-"},
		{"non-ASCII", "தமிழ்", "xxxxx-"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := Handle(tt.displayName)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(string(got), tt.wantPrefix) ||
				!hub.IsHubHandle(got) {
				t.Fatalf("Handle(%q) = %q", tt.displayName, got)
			}
		})
	}
}

// The suffix is what keeps a handle from disclosing the account it belongs to,
// so two handles for the same display name must not repeat.
func TestHandleSuffixIsRandom(t *testing.T) {
	t.Parallel()
	seen := map[hub.HubHandle]bool{}
	for range 100 {
		got, err := Handle("Grace Hopper")
		if err != nil {
			t.Fatal(err)
		}
		if seen[got] {
			t.Fatalf("Handle repeated %q", got)
		}
		seen[got] = true
	}
}

func TestHandleUsesCrockfordAlphabet(t *testing.T) {
	t.Parallel()
	for range 100 {
		got, err := Handle("Grace Hopper")
		if err != nil {
			t.Fatal(err)
		}
		suffix := string(got)[len("grace-"):]
		if len(suffix) != suffixLength {
			t.Fatalf("suffix %q length = %d", suffix, len(suffix))
		}
		if strings.ContainsAny(suffix, "ilou") {
			t.Fatalf("suffix %q contains an excluded letter", suffix)
		}
	}
}
