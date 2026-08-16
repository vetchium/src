// Package authorization contains Admin API authorization wire types.
package authorization

type AdminPermission string
type AdminPermissionID string

const (
	ViewUsers   AdminPermission = "admin:view_users"
	ManageUsers AdminPermission = "admin:manage_users"
)

type AdminAuthorization struct {
	Permissions []AdminPermissionID `json:"permissions"`
}

func IsAdminPermission(value AdminPermission) bool {
	return value == ViewUsers || value == ManageUsers
}

func ValidatePermissions(values []AdminPermission) bool {
	seen := make(map[AdminPermission]bool, len(values))
	for _, value := range values {
		if !IsAdminPermission(value) || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}
