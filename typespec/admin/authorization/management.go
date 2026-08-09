package authorization

import admincommon "github.com/vetchium/src/typespec/admin/common"

type GrantPermissionRequest struct {
	AdminUserID admincommon.AdminUserID `json:"admin_user_id"`
	Permission  AdminPermission         `json:"permission"`
}

type RevokePermissionRequest struct {
	AdminUserID admincommon.AdminUserID `json:"admin_user_id"`
	Permission  AdminPermission         `json:"permission"`
}

type PromoteToSuperadminRequest struct {
	AdminUserID admincommon.AdminUserID `json:"admin_user_id"`
}

type DemoteFromSuperadminRequest struct {
	AdminUserID admincommon.AdminUserID `json:"admin_user_id"`
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
	userID admincommon.AdminUserID, permission AdminPermission,
) []string {
	fields := validateTarget(userID)
	if !IsAdminPermission(permission) {
		fields = append(fields, "permission")
	}
	return fields
}

func validateTarget(userID admincommon.AdminUserID) []string {
	if !admincommon.IsAdminUserID(userID) {
		return []string{"admin_user_id"}
	}
	return []string{}
}
