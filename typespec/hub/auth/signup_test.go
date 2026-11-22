package auth

import (
	"slices"
	"strings"
	"testing"
)

func TestGetSignupDetailsRequestValidation(t *testing.T) {
	for token, want := range map[string][]string{
		strings.Repeat("t", 64):   {},
		"":                        {"signup_token"},
		"short":                   {"signup_token"},
		strings.Repeat("t", 31):   {"signup_token"},
		strings.Repeat("t", 4097): {"signup_token"},
	} {
		request := GetSignupDetailsRequest{SignupToken: HubSignupToken(token)}
		request.Normalize()
		if got := request.Validate(); !slices.Equal(got, want) {
			t.Errorf("Validate(%q) = %v, want %v", token, got, want)
		}
	}
}
