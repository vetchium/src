package users

import (
	"time"

	"github.com/vetchium/src/typespec/admin/authorization"
	admincommon "github.com/vetchium/src/typespec/admin/common"
	"github.com/vetchium/src/typespec/admin/user"
	"github.com/vetchium/src/typespec/common"
)

type AdminUserFilterText string

type ListUsersRequest struct {
	Limit              *common.PageSize               `json:"limit,omitempty"`
	PaginationKey      *common.PaginationKey          `json:"pagination_key,omitempty"`
	FilterEmailAddress *AdminUserFilterText           `json:"filter_email_address,omitempty"`
	FilterDisplayName  *AdminUserFilterText           `json:"filter_display_name,omitempty"`
	FilterState        *user.State                    `json:"filter_state,omitempty"`
	FilterIsSuperadmin *bool                          `json:"filter_is_superadmin,omitempty"`
	FilterPermission   *authorization.AdminPermission `json:"filter_permission,omitempty"`
}

func (r ListUsersRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}

func (r ListUsersRequest) Validate() []string {
	fields := make([]string, 0, 6)
	if !common.IsPageSize(r.EffectiveLimit()) {
		fields = append(fields, "limit")
	}
	if r.PaginationKey != nil &&
		!common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.FilterEmailAddress != nil &&
		!isAdminUserFilterText(*r.FilterEmailAddress) {
		fields = append(fields, "filter_email_address")
	}
	if r.FilterDisplayName != nil &&
		!isAdminUserFilterText(*r.FilterDisplayName) {
		fields = append(fields, "filter_display_name")
	}
	if r.FilterState != nil &&
		*r.FilterState != user.Active && *r.FilterState != user.Disabled {
		fields = append(fields, "filter_state")
	}
	if r.FilterPermission != nil &&
		!authorization.IsAdminPermission(*r.FilterPermission) {
		fields = append(fields, "filter_permission")
	}
	return fields
}

func isAdminUserFilterText(value AdminUserFilterText) bool {
	length := len([]rune(value))
	return length >= 1 && length <= 320
}

type AdminUserSummary struct {
	AdminUserID                admincommon.AdminUserID       `json:"admin_user_id"`
	EmailAddress               common.EmailAddress           `json:"email_address"`
	DisplayNames               []common.LocalizedDisplayName `json:"display_names"`
	PrimaryDisplayNameLanguage common.RegionalLanguageCode   `json:"primary_display_name_language"`
	State                      user.State                    `json:"state"`
	authorization.AdminAuthorization
	TOTPEnabled bool       `json:"totp_enabled"`
	LastLoginAt *time.Time `json:"last_login_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

type ListUsersResponse struct {
	Users             []AdminUserSummary    `json:"users"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type DisableUserRequest struct {
	AdminUserID admincommon.AdminUserID `json:"admin_user_id"`
}

func (r DisableUserRequest) Validate() []string {
	if !admincommon.IsAdminUserID(r.AdminUserID) {
		return []string{"admin_user_id"}
	}
	return []string{}
}

type EnableUserRequest struct {
	AdminUserID admincommon.AdminUserID `json:"admin_user_id"`
}

func (r EnableUserRequest) Validate() []string {
	if !admincommon.IsAdminUserID(r.AdminUserID) {
		return []string{"admin_user_id"}
	}
	return []string{}
}
