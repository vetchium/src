package users

import (
	"slices"

	"github.com/vetchium/src/typespec/orgs/authorization"
)

// reserved are the permissions only a superadmin may grant or revoke. A
// holder of org:manage_users may delegate every other permission (D17).
var reserved = []authorization.OrgPermission{
	authorization.Superadmin, authorization.ManageBilling,
}

// CanGrant reports whether a caller holding the effective permissions may
// grant, or revoke, the given permissions. Implied permissions count: a grant
// that confers a reserved permission is reserved too.
func CanGrant(
	callerEffective []string, granted []authorization.OrgPermissionID,
) bool {
	if slices.Contains(callerEffective, string(authorization.Superadmin)) {
		return true
	}
	for _, permission := range authorization.EffectivePermissions(granted) {
		for _, restricted := range reserved {
			if string(permission) == string(restricted) {
				return false
			}
		}
	}
	return true
}
