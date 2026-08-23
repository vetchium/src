package authorization

import (
	"slices"
	"testing"
)

func TestAdminPermissionsIsIndependentOfCallers(t *testing.T) {
	permissions := AdminPermissions()
	permissions[0] = "admin:tampered"
	if slices.Contains(AdminPermissions(), "admin:tampered") {
		t.Fatalf("AdminPermissions() = %v", AdminPermissions())
	}
	implied := Implies(ManageUsers)
	implied[0] = "admin:tampered"
	if !slices.Equal(Implies(ManageUsers), []AdminPermission{ViewUsers}) {
		t.Fatalf("Implies(ManageUsers) = %v", Implies(ManageUsers))
	}
	if len(Implies(ViewUsers)) != 0 {
		t.Fatalf("Implies(ViewUsers) = %v", Implies(ViewUsers))
	}
	if !slices.Equal(
		Implies(ManageHubSignupDomains),
		[]AdminPermission{ViewHubSignupDomains},
	) {
		t.Fatalf("Implies(ManageHubSignupDomains) = %v",
			Implies(ManageHubSignupDomains))
	}
}

func TestEffectivePermissionsResolvesImplications(t *testing.T) {
	cases := []struct {
		name   string
		direct []AdminPermissionID
		want   []AdminPermissionID
	}{
		{name: "empty", direct: nil, want: []AdminPermissionID{}},
		{
			name:   "manage implies view",
			direct: []AdminPermissionID{"admin:manage_users"},
			want: []AdminPermissionID{
				"admin:manage_users", "admin:view_users",
			},
		},
		{
			name: "already expanded",
			direct: []AdminPermissionID{
				"admin:view_users", "admin:manage_users",
			},
			want: []AdminPermissionID{
				"admin:manage_users", "admin:view_users",
			},
		},
		{
			name:   "unknown identifiers are preserved",
			direct: []AdminPermissionID{"admin:manage_domains"},
			want:   []AdminPermissionID{"admin:manage_domains"},
		},
		{
			name:   "manage signup domains implies view",
			direct: []AdminPermissionID{"admin:manage_hub_signup_domains"},
			want: []AdminPermissionID{
				"admin:manage_hub_signup_domains",
				"admin:view_hub_signup_domains",
			},
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := EffectivePermissions(testCase.direct)
			if !slices.Equal(got, testCase.want) {
				t.Fatalf("EffectivePermissions() = %v, want %v",
					got, testCase.want)
			}
		})
	}
}

func TestDirectPermissionsDropsImpliedGrants(t *testing.T) {
	cases := []struct {
		name      string
		effective []AdminPermissionID
		want      []AdminPermissionID
	}{
		{name: "empty", effective: nil, want: []AdminPermissionID{}},
		{
			name: "implied view is not a grant",
			effective: []AdminPermissionID{
				"admin:view_users", "admin:manage_users",
			},
			want: []AdminPermissionID{"admin:manage_users"},
		},
		{
			name:      "view alone is a grant",
			effective: []AdminPermissionID{"admin:view_users"},
			want:      []AdminPermissionID{"admin:view_users"},
		},
		{
			name: "unknown identifiers are preserved",
			effective: []AdminPermissionID{
				"admin:view_domains", "admin:manage_users",
				"admin:view_users",
			},
			want: []AdminPermissionID{
				"admin:manage_users", "admin:view_domains",
			},
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := DirectPermissions(testCase.effective)
			if !slices.Equal(got, testCase.want) {
				t.Fatalf("DirectPermissions() = %v, want %v",
					got, testCase.want)
			}
		})
	}
}

func TestValidatePermissionsRejectsUnknownAndDuplicate(t *testing.T) {
	cases := []struct {
		name   string
		values []AdminPermissionID
		want   bool
	}{
		{name: "empty", values: nil, want: true},
		{
			name: "every defined permission",
			values: []AdminPermissionID{
				"admin:view_users", "admin:manage_users",
				"admin:view_hub_signup_domains",
				"admin:manage_hub_signup_domains",
			},
			want: true,
		},
		{
			name:   "unknown",
			values: []AdminPermissionID{"admin:manage_domains"},
			want:   false,
		},
		{
			name: "duplicate",
			values: []AdminPermissionID{
				"admin:view_users", "admin:view_users",
			},
			want: false,
		},
		{name: "not a permission", values: []AdminPermissionID{""}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := ValidatePermissions(testCase.values); got != testCase.want {
				t.Fatalf("ValidatePermissions(%v) = %t, want %t",
					testCase.values, got, testCase.want)
			}
		})
	}
}

func TestSetPermissionsRequestValidate(t *testing.T) {
	request := SetPermissionsRequest{
		AdminUserID: "00000000-0000-4000-8000-000000000001",
		Permissions: []AdminPermissionID{"admin:manage_users"},
	}
	if fields := request.Validate(); len(fields) != 0 {
		t.Fatalf("valid request fields = %v", fields)
	}
	request.AdminUserID = "not-a-uuid"
	request.Permissions = []AdminPermissionID{"admin:manage_domains"}
	want := []string{"admin_user_id", "permissions"}
	if fields := request.Validate(); !slices.Equal(fields, want) {
		t.Fatalf("Validate() = %v, want %v", fields, want)
	}
}
