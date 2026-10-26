package marketplace_test

import (
	"testing"

	"github.com/vetchium/src/typespec/orgs/marketplace"
)

func TestReferralRoute(t *testing.T) {
	t.Parallel()
	if !marketplace.IsReferralRoute(marketplace.ReferralRouteSuggested) {
		t.Fatal("expected suggested to be valid")
	}
	if !marketplace.IsReferralRoute(marketplace.ReferralRouteDeclared) {
		t.Fatal("expected declared to be valid")
	}
	if marketplace.IsReferralRoute(marketplace.ReferralRoute("unknown")) {
		t.Fatal("expected unknown to be invalid")
	}
}
