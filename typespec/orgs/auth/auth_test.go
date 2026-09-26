package auth

import (
	"slices"
	"strings"
	"testing"
)

func TestRequestSignupClaimsTheEmailDomain(t *testing.T) {
	t.Parallel()
	request := RequestSignupRequest{
		EmailAddress: " IT@Eu.Example.COM ", PreferredLanguage: "de-DE",
	}
	original := request
	normalized := request
	normalized.Normalize()
	if original.EmailAddress != " IT@Eu.Example.COM " {
		t.Fatal("Normalize mutated the caller's copy")
	}
	if normalized.EmailAddress != "it@eu.example.com" ||
		normalized.Domain() != "eu.example.com" {
		t.Fatalf("normalized = %+v, domain = %q", normalized, normalized.Domain())
	}
	if fields := normalized.Validate(); len(fields) != 0 {
		t.Fatalf("valid signup rejected: %v", fields)
	}
	for _, test := range []struct {
		request RequestSignupRequest
		want    []string
	}{
		{
			RequestSignupRequest{EmailAddress: "it@localhost", PreferredLanguage: "ta"},
			[]string{"email_address"},
		},
		{
			RequestSignupRequest{EmailAddress: "it@10.0.0.1", PreferredLanguage: "ta"},
			[]string{"email_address"},
		},
		{
			RequestSignupRequest{EmailAddress: "not-an-address", PreferredLanguage: "fr-FR"},
			[]string{"email_address", "preferred_language"},
		},
	} {
		if got := test.request.Validate(); !slices.Equal(got, test.want) {
			t.Errorf("Validate(%+v) = %v, want %v", test.request, got, test.want)
		}
	}
}

func TestCompleteSignupValidation(t *testing.T) {
	t.Parallel()
	token := OrgSignupToken(strings.Repeat("a", 64))
	request := CompleteSignupRequest{
		SignupToken: token, OrgDisplayName: "  Acme Corp  ",
		Password: "a sufficiently long passphrase",
	}
	request.Normalize()
	if request.OrgDisplayName != "Acme Corp" || len(request.Validate()) != 0 {
		t.Fatalf("valid completion rejected: %+v %v", request, request.Validate())
	}
	invalid := CompleteSignupRequest{SignupToken: "short", Password: "short"}
	want := []string{"signup_token", "org_display_name", "password"}
	if got := invalid.Validate(); !slices.Equal(got, want) {
		t.Fatalf("Validate() = %v, want %v", got, want)
	}
}

func TestLoginAndPasswordResetNormalizeTheDomain(t *testing.T) {
	t.Parallel()
	login := LoginRequest{
		Domain: "Example.COM.", EmailAddress: " IT@Example.com", Password: "x",
	}
	login.Normalize()
	if login.Domain != "example.com" || login.EmailAddress != "it@example.com" ||
		len(login.Validate()) != 0 {
		t.Fatalf("login = %+v, fields = %v", login, login.Validate())
	}
	if got := (LoginRequest{}).Validate(); !slices.Equal(
		got, []string{"domain", "email_address", "password"},
	) {
		t.Fatalf("empty login fields = %v", got)
	}
	reset := RequestPasswordResetRequest{Domain: "example", EmailAddress: "x"}
	if got := reset.Validate(); !slices.Equal(
		got, []string{"domain", "email_address"},
	) {
		t.Fatalf("reset fields = %v", got)
	}
}
