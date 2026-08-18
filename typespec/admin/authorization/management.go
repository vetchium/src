package authorization

import adminspec "github.com/vetchium/src/typespec/admin"

type SetPermissionsRequest struct {
	AdminUserID adminspec.AdminUserID `json:"admin_user_id"`
	Permissions []AdminPermissionID   `json:"permissions"`
}

func (r SetPermissionsRequest) Validate() []string {
	fields := make([]string, 0, 2)
	if !adminspec.IsAdminUserID(r.AdminUserID) {
		fields = append(fields, "admin_user_id")
	}
	if !ValidatePermissions(r.Permissions) {
		fields = append(fields, "permissions")
	}
	return fields
}
