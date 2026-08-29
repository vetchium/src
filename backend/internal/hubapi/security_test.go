package hubapi

import (
	"strings"
	"testing"
	"time"

	coordinatorspec "github.com/vetchium/src/typespec/global-coordinator"
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
			got := Handle(
				tt.displayName,
				coordinatorspec.ShortID("00000000001"),
			)
			if !strings.HasPrefix(string(got), tt.wantPrefix) ||
				!hub.IsHubHandle(got) {
				t.Fatalf("Handle(%q) = %q", tt.displayName, got)
			}
		})
	}
}

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
