package directory

import (
	"slices"
	"testing"
	"time"
)

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

func TestOrgCommandValidation(t *testing.T) {
	t.Parallel()
	valid := ReserveOrgPrincipalRequest{
		CommandID:             "f4847331-5a4f-4eae-a5f4-cc131b0cd270",
		OrgDID:                "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
		Domain:                "eu.example.com",
		HomeTenantID:          "deu",
		ProvisioningExpiresAt: time.Now(),
	}
	if fields := valid.Validate(); len(fields) != 0 {
		t.Fatalf("valid reservation rejected: %v", fields)
	}
	invalid := ReserveOrgPrincipalRequest{
		CommandID: "not-a-uuid",
		OrgDID:    "018f7e32-7b5a-4d31-8fd0-f7e2a852f144",
		Domain:    "Example.com",
	}
	want := []string{
		"command_id", "org_did", "domain", "home_tenant_id",
		"provisioning_expires_at",
	}
	if fields := invalid.Validate(); !slices.Equal(fields, want) {
		t.Fatalf("invalid reservation fields = %v, want %v", fields, want)
	}

	lookup := ResolveOrgDomainRequest{Domain: " Example.COM. "}
	lookup.Normalize()
	if lookup.Domain != "example.com" || len(lookup.Validate()) != 0 {
		t.Fatalf("lookup normalized to %q", lookup.Domain)
	}
	for _, request := range []interface{ Validate() []string }{
		ReleaseOrgDomainRequest{
			CommandID: valid.CommandID, OrgDID: valid.OrgDID, Domain: "1.2.3.4",
		},
		ClaimOrgDomainRequest{
			CommandID: valid.CommandID, OrgDID: valid.OrgDID, Domain: "example",
		},
	} {
		if fields := request.Validate(); !slices.Equal(fields, []string{"domain"}) {
			t.Errorf("%T fields = %v, want [domain]", request, fields)
		}
	}
}

func TestEmailDigestAndKeyIDValidation(t *testing.T) {
	t.Parallel()
	digest := EmailDigest(
		"bee57e69a23d800d7718d0e79b2be1519e131232967431dba85e2737b6621f6e",
	)
	if !IsEmailDigest(digest) {
		t.Fatal("valid email digest rejected")
	}
	for _, value := range []EmailDigest{
		"", "not-hex", EmailDigest(string(digest) + "a"), "AA",
	} {
		if IsEmailDigest(value) {
			t.Errorf("IsEmailDigest(%q) = true, want false", value)
		}
	}
	keyID := DigestKeyID("909577e87ebd5395")
	if !IsDigestKeyID(keyID) {
		t.Fatal("valid digest key id rejected")
	}
	for _, value := range []DigestKeyID{"", "short", "TOOLONGBUTHEX0000"} {
		if IsDigestKeyID(value) {
			t.Errorf("IsDigestKeyID(%q) = true, want false", value)
		}
	}
}

func TestReserveHubPrincipalRequestValidatesEmailFields(t *testing.T) {
	t.Parallel()
	digest := EmailDigest(
		"bee57e69a23d800d7718d0e79b2be1519e131232967431dba85e2737b6621f6e",
	)
	valid := ReserveHubPrincipalRequest{
		CommandID:             "f4847331-5a4f-4eae-a5f4-cc131b0cd270",
		HubUserDID:            "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
		Handle:                "abcde000-0123456789a",
		HomeTenantID:          "sgp",
		ProvisioningExpiresAt: time.Now(),
		AccountEmailDigest:    digest,
		DigestKeyID:           "909577e87ebd5395",
	}
	if fields := valid.Validate(); len(fields) != 0 {
		t.Fatalf("valid reservation rejected: %v", fields)
	}
	invalid := valid
	invalid.AccountEmailDigest = "not-a-digest"
	invalid.DigestKeyID = "not-a-key-id"
	want := []string{"account_email_digest", "digest_key_id"}
	if fields := invalid.Validate(); !slices.Equal(fields, want) {
		t.Fatalf("invalid reservation fields = %v, want %v", fields, want)
	}
}

func TestEmailChangeCommandValidation(t *testing.T) {
	t.Parallel()
	digest := EmailDigest(
		"bee57e69a23d800d7718d0e79b2be1519e131232967431dba85e2737b6621f6e",
	)
	reserve := ReserveHubAccountEmailChangeRequest{
		CommandID:      "f4847331-5a4f-4eae-a5f4-cc131b0cd270",
		ChangeID:       "8dc99bc7-6995-4787-a7b8-1d19077cf449",
		HubUserDID:     "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
		NewEmailDigest: digest,
		NotAfter:       time.Now().Add(time.Hour),
		DigestKeyID:    "909577e87ebd5395",
	}
	if fields := reserve.Validate(); len(fields) != 0 {
		t.Fatalf("valid reserve rejected: %v", fields)
	}
	empty := ReserveHubAccountEmailChangeRequest{}
	want := []string{
		"command_id", "change_id", "hub_user_did", "new_email_digest",
		"not_after", "digest_key_id",
	}
	if fields := empty.Validate(); !slices.Equal(fields, want) {
		t.Fatalf("empty reserve fields = %v, want %v", fields, want)
	}

	finalize := FinalizeHubAccountEmailChangeRequest{
		CommandID: reserve.CommandID, ChangeID: reserve.ChangeID,
		HubUserDID: reserve.HubUserDID,
	}
	if fields := finalize.Validate(); len(fields) != 0 {
		t.Fatalf("valid finalize rejected: %v", fields)
	}

	abandon := AbandonHubAccountEmailChangeRequest{
		CommandID: reserve.CommandID, ChangeID: reserve.ChangeID,
		HubUserDID: reserve.HubUserDID, NotAfter: reserve.NotAfter,
	}
	if fields := abandon.Validate(); len(fields) != 0 {
		t.Fatalf("valid abandon rejected: %v", fields)
	}
	abandon.NotAfter = time.Time{}
	if fields := abandon.Validate(); !slices.Equal(fields, []string{"not_after"}) {
		t.Fatalf("abandon missing not_after fields = %v", fields)
	}
}
