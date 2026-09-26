// Package authorization contains Org API authorization wire types.
package authorization

import "slices"

type OrgPermission string
type OrgPermissionID string

const Superadmin OrgPermission = "org:superadmin"

var orgPermissions = []OrgPermission{Superadmin}

// OrgPermissions returns every permission this contract version defines.
func OrgPermissions() []OrgPermission {
	return slices.Clone(orgPermissions)
}

// Holds reports whether effective permissions include permission.
func Holds(effective []OrgPermissionID, permission OrgPermission) bool {
	return slices.Contains(effective, OrgPermissionID(permission))
}
