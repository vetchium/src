package orgs

import "testing"

func TestOrgDomain(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		value string
		valid bool
	}{
		{"example.com", true},
		{"eu.example.co.uk", true},
		{"xn--bcher-kva.example", true},
		{"example", false},
		{"Example.com", false},
		{"example.com.", false},
		{"example.123", false},
		{"192.168.1.1", false},
		{"-bad.example.com", false},
		{"under_score.example.com", false},
	} {
		if got := IsOrgDomain(OrgDomain(test.value)); got != test.valid {
			t.Errorf("IsOrgDomain(%q) = %t, want %t", test.value, got, test.valid)
		}
	}
	if NormalizeOrgDomain(" Example.COM. ") != "example.com" {
		t.Fatal("domain was not normalized")
	}
}

func TestIsSpecialUseDomain(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		value   string
		special bool
	}{
		{"acme.test", true},
		{"eu.acme.test", true},
		{"acme.example", true},
		{"example.com", true},
		{"eu.example.org", true},
		{"printer.local", true},
		{"router.home.arpa", true},
		{"acme.internal", true},
		{"acme.com", false},
		{"latest.com", false},
		{"example.co.uk", false},
		{"myexample.com", false},
		{"test.com", false},
		{"arpa.example.net.au", false},
	} {
		got := IsSpecialUseDomain(OrgDomain(test.value))
		if got != test.special {
			t.Errorf(
				"IsSpecialUseDomain(%q) = %t, want %t",
				test.value, got, test.special,
			)
		}
	}
}

func TestOrgDID(t *testing.T) {
	t.Parallel()
	if !IsOrgDID("018f7e32-7b5a-7d31-8fd0-f7e2a852f144") {
		t.Fatal("UUIDv7 rejected")
	}
	if IsOrgDID("018f7e32-7b5a-4d31-8fd0-f7e2a852f144") {
		t.Fatal("UUIDv4 accepted")
	}
}
