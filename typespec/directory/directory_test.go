package directory

import "testing"

func TestIdentifiers(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		value string
		valid bool
	}{
		{"mary-jane", true},
		{"api", false},
		{"abcde000-0123456789a", false},
		{"two--hyphens", false},
	} {
		if got := IsHubAlias(HubAlias(test.value)); got != test.valid {
			t.Errorf("IsHubAlias(%q) = %t, want %t", test.value, got, test.valid)
		}
	}
	if !IsProfileSlug("abcde000-0123456789a") {
		t.Fatal("permanent handle was not accepted as a profile slug")
	}
	if !IsTenantID("ind1") || IsTenantID("IN") {
		t.Fatal("tenant validation does not enforce canonical syntax")
	}
}

func TestDowngradeAliasReleaseRequiresNullTarget(t *testing.T) {
	alias := HubAlias("mary-jane")
	request := SetHubAliasRequest{
		CommandID:               "f4847331-5a4f-4eae-a5f4-cc131b0cd270",
		HubUserDID:              "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
		DowngradeReleaseIfAlias: &alias,
	}
	if fields := request.Validate(); len(fields) != 0 {
		t.Fatalf("valid conditional release rejected: %v", fields)
	}
	request.ProfileAlias = &alias
	if fields := request.Validate(); len(fields) != 1 ||
		fields[0] != "downgrade_release_if_alias" {
		t.Fatalf("claim with downgrade bypass accepted: %v", fields)
	}
}
