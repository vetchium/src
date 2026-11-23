package users

import (
	"testing"

	"github.com/vetchium/src/typespec/orgs/authorization"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

func TestSeatLimit(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		current subscriptionspec.PlanOID
		want    int
	}{
		{"free", "org-free-tier", 5},
		{"silver", "org-silver-tier", 50},
		{"gold", "org-gold-tier", 1000},
		{"unknown plan", "org-platinum-tier", 0},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if got := SeatLimit(testCase.current); got != testCase.want {
				t.Fatalf("SeatLimit() = %d, want %d", got, testCase.want)
			}
		})
	}
}

func TestCanGrant(t *testing.T) {
	t.Parallel()
	superadmin := []string{"org:manage_billing", "org:manage_users", "org:superadmin"}
	manager := []string{"org:manage_users"}
	cases := []struct {
		name    string
		caller  []string
		granted []authorization.OrgPermissionID
		want    bool
	}{
		{"superadmin grants superadmin", superadmin, []authorization.OrgPermissionID{"org:superadmin"}, true},
		{"superadmin grants billing", superadmin, []authorization.OrgPermissionID{"org:manage_billing"}, true},
		{"superadmin grants approval", superadmin, []authorization.OrgPermissionID{"org:approve_openings"}, true},
		{"manager grants nothing", manager, nil, true},
		{"manager grants manage_users", manager, []authorization.OrgPermissionID{"org:manage_users"}, true},
		{"manager grants view openings", manager, []authorization.OrgPermissionID{"org:view_openings"}, true},
		{"manager grants manage openings", manager, []authorization.OrgPermissionID{"org:manage_openings"}, true},
		{"manager grants manage candidacies", manager, []authorization.OrgPermissionID{"org:manage_candidacies"}, true},
		{"manager grants manage providers", manager, []authorization.OrgPermissionID{"org:manage_providers"}, true},
		{"manager grants manage listings", manager, []authorization.OrgPermissionID{"org:manage_listings"}, true},
		{"manager grants fulfil engagements", manager, []authorization.OrgPermissionID{"org:fulfil_engagements"}, true},
		{"manager cannot grant approve openings", manager, []authorization.OrgPermissionID{"org:approve_openings"}, false},
		{"manager cannot grant superadmin", manager, []authorization.OrgPermissionID{"org:superadmin"}, false},
		{"manager cannot grant billing", manager, []authorization.OrgPermissionID{"org:manage_billing"}, false},
		{"manager cannot grant AI management", manager, []authorization.OrgPermissionID{"org:manage_ai"}, false},
		{"superadmin grants AI management", superadmin, []authorization.OrgPermissionID{"org:manage_ai"}, true},
		{
			"a reserved grant hides in a mixed set", manager,
			[]authorization.OrgPermissionID{"org:manage_users", "org:manage_billing"}, false,
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if got := CanGrant(testCase.caller, testCase.granted); got != testCase.want {
				t.Fatalf("CanGrant() = %t, want %t", got, testCase.want)
			}
		})
	}
}
