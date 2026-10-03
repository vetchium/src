// Package authorization contains Org API authorization wire types.
package authorization

import "slices"

type OrgPermission string
type OrgPermissionID string

const (
	Superadmin    OrgPermission = "org:superadmin"
	ManageUsers   OrgPermission = "org:manage_users"
	ManageBilling OrgPermission = "org:manage_billing"
)

// orgPermissions is ordered the way portals present permissions rather than
// lexically, so a permission and the permissions it implies stay adjacent.
var orgPermissions = []OrgPermission{Superadmin, ManageUsers, ManageBilling}

var permissionImplications = map[OrgPermission][]OrgPermission{
	Superadmin: {ManageUsers, ManageBilling},
}

// OrgPermissions returns every permission this contract version defines.
func OrgPermissions() []OrgPermission {
	return slices.Clone(orgPermissions)
}

// Implies returns the permissions conferred by holding permission. Grants are
// stored directly and implications are resolved when effective permissions are
// reported, so a caller must never persist the result as a separate grant.
func Implies(permission OrgPermission) []OrgPermission {
	return slices.Clone(permissionImplications[permission])
}

// Holds reports whether effective permissions include permission.
func Holds(effective []OrgPermissionID, permission OrgPermission) bool {
	return slices.Contains(effective, OrgPermissionID(permission))
}

// EffectivePermissions expands direct grants with everything they imply.
// Identifiers this contract version does not define are preserved so a newer
// peer's permissions survive a round trip through an older one.
func EffectivePermissions(direct []OrgPermissionID) []OrgPermissionID {
	effective := make([]OrgPermissionID, 0, len(direct))
	for _, value := range direct {
		effective = appendUnique(effective, value)
		for _, implied := range permissionImplications[OrgPermission(value)] {
			effective = appendUnique(effective, OrgPermissionID(implied))
		}
	}
	slices.Sort(effective)
	return effective
}

// DirectPermissions reduces effective permissions to the grants that produce
// them by dropping every permission another listed permission already implies.
func DirectPermissions(effective []OrgPermissionID) []OrgPermissionID {
	direct := make([]OrgPermissionID, 0, len(effective))
	for _, value := range effective {
		if !impliedByAny(effective, value) {
			direct = appendUnique(direct, value)
		}
	}
	slices.Sort(direct)
	return direct
}

func impliedByAny(values []OrgPermissionID, wanted OrgPermissionID) bool {
	for _, value := range values {
		if value == wanted {
			continue
		}
		implied := permissionImplications[OrgPermission(value)]
		if slices.Contains(implied, OrgPermission(wanted)) {
			return true
		}
	}
	return false
}

func appendUnique(
	values []OrgPermissionID, value OrgPermissionID,
) []OrgPermissionID {
	if slices.Contains(values, value) {
		return values
	}
	return append(values, value)
}

func IsOrgPermission(value OrgPermissionID) bool {
	return slices.Contains(orgPermissions, OrgPermission(value))
}

// ValidatePermissions accepts only defined permissions without duplicates.
// Requests carry the extensible identifier so a client can return permissions
// it does not recognize, which makes server-side membership the check that
// keeps an unknown value out of storage.
func ValidatePermissions(values []OrgPermissionID) bool {
	seen := make(map[OrgPermissionID]bool, len(values))
	for _, value := range values {
		if !IsOrgPermission(value) || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}
