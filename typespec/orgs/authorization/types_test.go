package authorization

import (
	"slices"
	"testing"
)

func TestHolds(t *testing.T) {
	t.Parallel()
	if !Holds([]OrgPermissionID{"org:future", "org:superadmin"}, Superadmin) {
		t.Fatal("held permission not found")
	}
	if Holds([]OrgPermissionID{"org:future"}, Superadmin) {
		t.Fatal("unheld permission reported as held")
	}
}

func TestImpliesIsIndependentOfCallers(t *testing.T) {
	t.Parallel()
	want := []OrgPermission{ManageUsers, ManageBilling}
	implied := Implies(Superadmin)
	if !slices.Equal(implied, want) {
		t.Fatalf("Implies(Superadmin) = %v, want %v", implied, want)
	}
	implied[0] = "org:tampered"
	if !slices.Equal(Implies(Superadmin), want) {
		t.Fatal("caller mutated the implication map")
	}
	if len(Implies(ManageUsers)) != 0 || len(Implies(ManageBilling)) != 0 {
		t.Fatal("manage permissions must not imply anything")
	}
	permissions := OrgPermissions()
	permissions[0] = "org:tampered"
	if slices.Contains(OrgPermissions(), "org:tampered") {
		t.Fatal("caller mutated the permission list")
	}
}

func TestEffectivePermissions(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		direct []OrgPermissionID
		want   []OrgPermissionID
	}{
		{"empty", nil, []OrgPermissionID{}},
		{
			"superadmin implies both",
			[]OrgPermissionID{"org:superadmin"},
			[]OrgPermissionID{
				"org:manage_billing", "org:manage_users", "org:superadmin",
			},
		},
		{
			"already expanded",
			[]OrgPermissionID{"org:manage_users", "org:superadmin"},
			[]OrgPermissionID{
				"org:manage_billing", "org:manage_users", "org:superadmin",
			},
		},
		{
			"unknown preserved",
			[]OrgPermissionID{"org:future"},
			[]OrgPermissionID{"org:future"},
		},
		{
			"billing alone stays alone",
			[]OrgPermissionID{"org:manage_billing"},
			[]OrgPermissionID{"org:manage_billing"},
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got := EffectivePermissions(testCase.direct)
			if !slices.Equal(got, testCase.want) {
				t.Fatalf("EffectivePermissions() = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestDirectPermissionsDropsImpliedGrants(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name      string
		effective []OrgPermissionID
		want      []OrgPermissionID
	}{
		{"empty", nil, []OrgPermissionID{}},
		{
			"implied are not grants",
			[]OrgPermissionID{
				"org:manage_billing", "org:manage_users", "org:superadmin",
			},
			[]OrgPermissionID{"org:superadmin"},
		},
		{
			"independent grants stay",
			[]OrgPermissionID{"org:manage_billing", "org:manage_users"},
			[]OrgPermissionID{"org:manage_billing", "org:manage_users"},
		},
		{
			"unknown preserved",
			[]OrgPermissionID{"org:future", "org:manage_users"},
			[]OrgPermissionID{"org:future", "org:manage_users"},
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got := DirectPermissions(testCase.effective)
			if !slices.Equal(got, testCase.want) {
				t.Fatalf("DirectPermissions() = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestValidatePermissionsRejectsUnknownAndDuplicate(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		values []OrgPermissionID
		want   bool
	}{
		{"empty", nil, true},
		{"defined", []OrgPermissionID{"org:manage_users", "org:manage_billing"}, true},
		{"unknown", []OrgPermissionID{"org:future"}, false},
		{"duplicate", []OrgPermissionID{"org:manage_users", "org:manage_users"}, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if got := ValidatePermissions(testCase.values); got != testCase.want {
				t.Fatalf("ValidatePermissions() = %t, want %t", got, testCase.want)
			}
		})
	}
}
