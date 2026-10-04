package signupcompletion

import (
	"context"
	"errors"
	"testing"
)

// The special-use refusal runs before any query, so a Service without a
// database exercises it.
func TestAdmitLocallyRefusesSpecialUseDomainsUnlessAllowed(t *testing.T) {
	t.Parallel()
	for _, domain := range []string{"acme.test", "eu.acme.example"} {
		err := (&Service{}).admitLocally(context.Background(), domain)
		if !errors.Is(err, ErrDomainBlocked) {
			t.Errorf("admitLocally(%q) = %v, want ErrDomainBlocked", domain, err)
		}
	}
}
