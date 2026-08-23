// Package authorization contains Admin API authorization wire types.
package authorization

import "slices"

type AdminPermission string
type AdminPermissionID string

const (
	ViewUsers              AdminPermission = "admin:view_users"
	ManageUsers            AdminPermission = "admin:manage_users"
	ViewHubSignupDomains   AdminPermission = "admin:view_hub_signup_domains"
	ManageHubSignupDomains AdminPermission = "admin:manage_hub_signup_domains"
)

// adminPermissions is ordered the way portals present permissions rather than
// lexically, so a permission and the permissions it implies stay adjacent.
var adminPermissions = []AdminPermission{
	ViewUsers,
	ManageUsers,
	ViewHubSignupDomains,
	ManageHubSignupDomains,
}

var permissionImplications = map[AdminPermission][]AdminPermission{
	ManageUsers:            {ViewUsers},
	ManageHubSignupDomains: {ViewHubSignupDomains},
}

// AdminPermissions returns every permission this contract version defines.
func AdminPermissions() []AdminPermission {
	return slices.Clone(adminPermissions)
}

// Implies returns the permissions conferred by holding permission. Grants are
// stored directly and implications are resolved when effective permissions are
// reported, so a caller must never persist the result as a separate grant.
func Implies(permission AdminPermission) []AdminPermission {
	return slices.Clone(permissionImplications[permission])
}

// EffectivePermissions expands direct grants with everything they imply.
// Identifiers this contract version does not define are preserved so a newer
// peer's permissions survive a round trip through an older one.
func EffectivePermissions(direct []AdminPermissionID) []AdminPermissionID {
	effective := make([]AdminPermissionID, 0, len(direct))
	for _, value := range direct {
		effective = appendUnique(effective, value)
		for _, implied := range permissionImplications[AdminPermission(value)] {
			effective = appendUnique(effective, AdminPermissionID(implied))
		}
	}
	slices.Sort(effective)
	return effective
}

// DirectPermissions reduces effective permissions to the grants that produce
// them by dropping every permission another listed permission already implies.
func DirectPermissions(effective []AdminPermissionID) []AdminPermissionID {
	direct := make([]AdminPermissionID, 0, len(effective))
	for _, value := range effective {
		if !impliedByAny(effective, value) {
			direct = appendUnique(direct, value)
		}
	}
	slices.Sort(direct)
	return direct
}

func impliedByAny(values []AdminPermissionID, wanted AdminPermissionID) bool {
	for _, value := range values {
		if value == wanted {
			continue
		}
		implied := permissionImplications[AdminPermission(value)]
		if slices.Contains(implied, AdminPermission(wanted)) {
			return true
		}
	}
	return false
}

func appendUnique(
	values []AdminPermissionID, value AdminPermissionID,
) []AdminPermissionID {
	if slices.Contains(values, value) {
		return values
	}
	return append(values, value)
}

type AdminAuthorization struct {
	Permissions []AdminPermissionID `json:"permissions"`
}

func IsAdminPermission(value AdminPermissionID) bool {
	return slices.Contains(adminPermissions, AdminPermission(value))
}

// ValidatePermissions accepts only defined permissions without duplicates.
// Requests carry the extensible identifier so a client can return permissions
// it does not recognize, which makes server-side membership the check that
// keeps an unknown value out of storage.
func ValidatePermissions(values []AdminPermissionID) bool {
	seen := make(map[AdminPermissionID]bool, len(values))
	for _, value := range values {
		if !IsAdminPermission(value) || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}
