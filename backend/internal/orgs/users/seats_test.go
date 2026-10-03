package users

import (
	"testing"

	"github.com/vetchium/src/typespec/orgs/authorization"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

func planPtr(plan subscriptionspec.Plan) *subscriptionspec.Plan { return &plan }

func TestSeatLimit(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name          string
		current       subscriptionspec.PlanOID
		scheduled     *subscriptionspec.Plan
		google        bool
		wantLimit     int
		wantUnlimited bool
	}{
		{"free", "org-free-tier", nil, false, 5, false},
		{"silver", "org-silver-tier", nil, false, 50, false},
		{"gold", "org-gold-tier", nil, false, 1000, false},
		{"gold with google is unlimited", "org-gold-tier", nil, true, 0, true},
		{
			"downgrade lowers the cap early",
			"org-gold-tier", planPtr(subscriptionspec.SilverTier), false, 50, false,
		},
		{
			"downgrade lowers an unlimited cap",
			"org-gold-tier", planPtr(subscriptionspec.SilverTier), true, 50, false,
		},
		{
			"cancel to free",
			"org-silver-tier", planPtr(subscriptionspec.FreeTier), false, 5, false,
		},
		{
			"same-plan schedule keeps the cap",
			"org-silver-tier", planPtr(subscriptionspec.SilverTier), false, 50, false,
		},
		{"unknown plan", "org-platinum-tier", nil, true, 0, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			limit, unlimited := SeatLimit(
				testCase.current, testCase.scheduled, testCase.google,
			)
			if limit != testCase.wantLimit || unlimited != testCase.wantUnlimited {
				t.Fatalf("SeatLimit() = %d, %t, want %d, %t",
					limit, unlimited, testCase.wantLimit, testCase.wantUnlimited)
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
		{"manager grants nothing", manager, nil, true},
		{"manager grants manage_users", manager, []authorization.OrgPermissionID{"org:manage_users"}, true},
		{"manager cannot grant superadmin", manager, []authorization.OrgPermissionID{"org:superadmin"}, false},
		{"manager cannot grant billing", manager, []authorization.OrgPermissionID{"org:manage_billing"}, false},
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
