package authorization

import adminspec "github.com/vetchium/src/typespec/admin"

type GrantPermissionRequest struct {
	AdminUserID adminspec.AdminUserID `json:"admin_user_id"`
	Permission  AdminPermission       `json:"permission"`
}

type RevokePermissionRequest struct {
	AdminUserID adminspec.AdminUserID `json:"admin_user_id"`
	Permission  AdminPermission       `json:"permission"`
}

type PromoteToSuperadminRequest struct {
	AdminUserID adminspec.AdminUserID `json:"admin_user_id"`
}

type DemoteFromSuperadminRequest struct {
	AdminUserID adminspec.AdminUserID `json:"admin_user_id"`
}

func (r GrantPermissionRequest) Validate() []string {
	return validatePermissionTarget(r.AdminUserID, r.Permission)
}

func (r RevokePermissionRequest) Validate() []string {
	return validatePermissionTarget(r.AdminUserID, r.Permission)
}

func (r PromoteToSuperadminRequest) Validate() []string {
	return validateTarget(r.AdminUserID)
}

func (r DemoteFromSuperadminRequest) Validate() []string {
	return validateTarget(r.AdminUserID)
}

func validatePermissionTarget(
	userID adminspec.AdminUserID, permission AdminPermission,
) []string {
	fields := validateTarget(userID)
	if !IsAdminPermission(permission) {
		fields = append(fields, "permission")
	}
	return fields
}

func validateTarget(userID adminspec.AdminUserID) []string {
	if !adminspec.IsAdminUserID(userID) {
		return []string{"admin_user_id"}
	}
	return []string{}
}
