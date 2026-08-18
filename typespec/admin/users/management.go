package users

import (
	"time"

	adminspec "github.com/vetchium/src/typespec/admin"
	"github.com/vetchium/src/typespec/admin/authorization"
	"github.com/vetchium/src/typespec/admin/user"
	"github.com/vetchium/src/typespec/common"
)

type AdminUserFilterText string
type AdminLastLoginFilter string

const (
	LastLoginNever          AdminLastLoginFilter = "never"
	LastLoginInactive30Days AdminLastLoginFilter = "inactive_30_days"
	LastLoginInactive90Days AdminLastLoginFilter = "inactive_90_days"
)

type ListUsersRequest struct {
	Limit               *common.PageSize                  `json:"limit,omitempty"`
	PaginationKey       *common.PaginationKey             `json:"pagination_key,omitempty"`
	FilterSearch        *AdminUserFilterText              `json:"filter_search,omitempty"`
	FilterState         *user.State                       `json:"filter_state,omitempty"`
	FilterPermissions   []authorization.AdminPermissionID `json:"filter_permissions,omitempty"`
	FilterNoPermissions *bool                             `json:"filter_no_permissions,omitempty"`
	FilterTOTPEnabled   *bool                             `json:"filter_totp_enabled,omitempty"`
	FilterLastLogin     *AdminLastLoginFilter             `json:"filter_last_login,omitempty"`
}

func (r ListUsersRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}

func (r ListUsersRequest) Validate() []string {
	fields := make([]string, 0, 7)
	if !common.IsPageSize(r.EffectiveLimit()) {
		fields = append(fields, "limit")
	}
	if r.PaginationKey != nil &&
		!common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.FilterSearch != nil && !isAdminUserFilterText(*r.FilterSearch) {
		fields = append(fields, "filter_search")
	}
	if r.FilterState != nil &&
		*r.FilterState != user.Active && *r.FilterState != user.Disabled {
		fields = append(fields, "filter_state")
	}
	if !authorization.ValidatePermissions(r.FilterPermissions) {
		fields = append(fields, "filter_permissions")
	}
	if r.FilterLastLogin != nil &&
		!isAdminLastLoginFilter(*r.FilterLastLogin) {
		fields = append(fields, "filter_last_login")
	}
	return fields
}

func isAdminLastLoginFilter(value AdminLastLoginFilter) bool {
	return value == LastLoginNever || value == LastLoginInactive30Days ||
		value == LastLoginInactive90Days
}

func isAdminUserFilterText(value AdminUserFilterText) bool {
	length := len([]rune(value))
	return length >= 1 && length <= 320
}

type AdminUserSummary struct {
	AdminUserID                adminspec.AdminUserID         `json:"admin_user_id"`
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
	AdminUserID adminspec.AdminUserID `json:"admin_user_id"`
}

func (r DisableUserRequest) Validate() []string {
	if !adminspec.IsAdminUserID(r.AdminUserID) {
		return []string{"admin_user_id"}
	}
	return []string{}
}

type EnableUserRequest struct {
	AdminUserID adminspec.AdminUserID `json:"admin_user_id"`
}

func (r EnableUserRequest) Validate() []string {
	if !adminspec.IsAdminUserID(r.AdminUserID) {
		return []string{"admin_user_id"}
	}
	return []string{}
}
