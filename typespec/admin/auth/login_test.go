package auth

import (
	"slices"
	"testing"
)

func TestLoginRequestNormalize(t *testing.T) {
	request := LoginRequest{
		EmailAddress: " ADMIN@example.com ",
		Password:     "password",
	}

	request.Normalize()
	if request.EmailAddress != "admin@example.com" {
		t.Fatalf(
			"normalized email_address = %q, want admin@example.com",
			request.EmailAddress,
		)
	}
}

func TestLoginRequestValidate(t *testing.T) {
	tests := []struct {
		name          string
		request       LoginRequest
		invalidFields []string
	}{
		{
			name: "valid normalized request",
			request: LoginRequest{
				EmailAddress: "admin@example.com",
				Password:     "password",
			},
		},
		{
			name: "normalization precedes validation",
			request: LoginRequest{
				EmailAddress: " ADMIN@example.com ",
				Password:     "password",
			},
		},
		{
			name: "invalid email",
			request: LoginRequest{
				EmailAddress: "not-an-email",
				Password:     "password",
			},
			invalidFields: []string{"email_address"},
		},
		{
			name: "empty password",
			request: LoginRequest{
				EmailAddress: "admin@example.com",
			},
			invalidFields: []string{"password"},
		},
		{
			name:          "all fields invalid",
			request:       LoginRequest{},
			invalidFields: []string{"email_address", "password"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.request.Validate()
			if !slices.Equal(got, tt.invalidFields) {
				t.Fatalf("Validate() = %v, want %v", got, tt.invalidFields)
			}
		})
	}
}

func TestReauthenticateRequestValidate(t *testing.T) {
	if fields := (ReauthenticateRequest{}).Validate(); !slices.Equal(fields, []string{"password"}) {
		t.Fatalf("empty password fields = %v", fields)
	}
	if fields := (ReauthenticateRequest{Password: "current-password"}).Validate(); len(fields) != 0 {
		t.Fatalf("valid password fields = %v", fields)
	}
}
