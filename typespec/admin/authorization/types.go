// Package authorization contains Admin API authorization wire types.
package authorization

type AdminPermission string
type AdminPermissionID string

const (
	ViewUsers   AdminPermission = "admin:view_users"
	ManageUsers AdminPermission = "admin:manage_users"
)

type AdminAuthorization struct {
	IsSuperadmin bool                `json:"is_superadmin"`
	Permissions  []AdminPermissionID `json:"permissions"`
}

func IsAdminPermission(value AdminPermission) bool {
	return value == ViewUsers || value == ManageUsers
}
