package auth

import (
	"bytes"
	"testing"
)

func TestNewSessionToken(t *testing.T) {
	token, hash, err := NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	if token == "" {
		t.Fatal("token is empty")
	}
	if len(hash) != 32 {
		t.Fatalf("hash length = %d, want 32", len(hash))
	}
	if !bytes.Equal(hash, HashSessionToken(token)) {
		t.Fatal("returned hash does not match token")
	}
	if bytes.Contains(hash, []byte(token)) {
		t.Fatal("hash contains plaintext token")
	}
}

func TestBearerToken(t *testing.T) {
	tests := []struct {
		header string
		want   string
		ok     bool
	}{
		{header: "Bearer token", want: "token", ok: true},
		{header: "bearer token", want: "token", ok: true},
		{header: "  Bearer   token  ", want: "token", ok: true},
		{header: "token"},
		{header: "Basic token"},
		{header: "Bearer"},
		{header: "Bearer one two"},
	}
	for _, test := range tests {
		t.Run(test.header, func(t *testing.T) {
			got, ok := BearerToken(test.header)
			if got != test.want || ok != test.ok {
				t.Fatalf("BearerToken(%q) = (%q, %t), want (%q, %t)", test.header, got, ok, test.want, test.ok)
			}
		})
	}
}
