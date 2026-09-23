package common

import "testing"

func TestProfessionalDomain(t *testing.T) {
	t.Parallel()
	if got := NormalizeProfessionalDomain("  EXAMPLE.COM. "); got != "example.com" {
		t.Fatalf("normalized domain = %q", got)
	}
	for _, value := range []ProfessionalDomain{
		"example.com", "xn--bcher-kva.example", "foo.123",
	} {
		if !IsProfessionalDomain(value) {
			t.Errorf("valid domain %q rejected", value)
		}
	}
	for _, value := range []ProfessionalDomain{
		"", "example", "-foo.example", "foo-.example", "foo..example",
		"*.example", "foo@example.com", "https://example.com", "foo:80.example",
		"bücher.example", "127.0.0.1", "[::1]", "foo.example..",
	} {
		if IsProfessionalDomain(value) {
			t.Errorf("invalid domain %q accepted", value)
		}
	}
}
