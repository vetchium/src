package common

import (
	"strings"
	"testing"
)

func TestScalarValidationBoundaries(t *testing.T) {
	tests := []struct {
		name string
		got  bool
		want bool
	}{
		{"opaque minimum", IsOpaqueToken(string(make([]byte, 32))), true},
		{"opaque too short", IsOpaqueToken("short"), false},
		{"opaque unicode below minimum", IsOpaqueToken(strings.Repeat("🙂", 31)), false},
		{"opaque unicode minimum", IsOpaqueToken(strings.Repeat("🙂", 32)), true},
		{"opaque unicode maximum", IsOpaqueToken(strings.Repeat("🙂", 4096)), true},
		{"opaque unicode above maximum", IsOpaqueToken(strings.Repeat("🙂", 4097)), false},
		{"TOTP", IsTOTPCode("012345"), true},
		{"TOTP non-digit", IsTOTPCode("01234x"), false},
		{"recovery", IsTOTPRecoveryCode("ABCD-1234"), true},
		{"recovery invalid", IsTOTPRecoveryCode("bad/code"), false},
		{"password unicode", IsNewPassword(NewPassword("🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂")), true},
		{"English locale", IsFrontendLocale("en-US"), true},
		{"Tamil locale", IsFrontendLocale("ta"), true},
		{"German locale", IsFrontendLocale("de-DE"), true},
		{"unsupported locale", IsFrontendLocale("fr-FR"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.got != tt.want {
				t.Fatalf("got %v, want %v", tt.got, tt.want)
			}
		})
	}
}

func TestIsCountryCode(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		value CountryCode
		want  bool
	}{
		{"India", "IND", true},
		{"Singapore", "SGP", true},
		{"lowercase", "ind", false},
		{"unknown", "ZZZ", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := IsCountryCode(tt.value); got != tt.want {
				t.Fatalf("IsCountryCode(%q) = %v, want %v", tt.value, got, tt.want)
			}
		})
	}
}

func TestPaginationKeyUnicodeBoundaries(t *testing.T) {
	for _, tt := range []struct {
		value string
		want  bool
	}{
		{"🙂", true},
		{strings.Repeat("🙂", 4096), true},
		{strings.Repeat("🙂", 4097), false},
	} {
		if got := IsPaginationKey(PaginationKey(tt.value)); got != tt.want {
			t.Errorf("IsPaginationKey(%d runes) = %v, want %v", len([]rune(tt.value)), got, tt.want)
		}
	}
}

func TestEmailAddressPolicy(t *testing.T) {
	tests := []struct {
		value string
		want  bool
	}{
		{"person@example.test", true},
		{" First.Last+tag@Example.COM ", true},
		{"a@localhost", true},
		{"a@.", false},
		{".a@example.test", false},
		{"a..b@example.test", false},
		{"a@-example.test", false},
		{"a@example-.test", false},
		{"a@example..test", false},
		{"display <a@example.test>", false},
		{"\"quoted\"@example.test", false},
		{"a@exa_mple.test", false},
		{strings.Repeat("a", 65) + "@example.test", false},
	}
	for _, tt := range tests {
		if got := IsEmailAddress(EmailAddress(tt.value)); got != tt.want {
			t.Errorf("IsEmailAddress(%q) = %v, want %v", tt.value, got, tt.want)
		}
	}
}
