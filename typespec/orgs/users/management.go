package users

import (
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/authorization"
)

type OrgUserState string

const (
	Active   OrgUserState = "active"
	Disabled OrgUserState = "disabled"
)

type DisabledReason string

const (
	DisabledManual     DisabledReason = "manual"
	DisabledNonpayment DisabledReason = "nonpayment"
)

type UserStateFilter string

const (
	FilterActive             UserStateFilter = "active"
	FilterDisabledManual     UserStateFilter = "disabled-manual"
	FilterDisabledNonpayment UserStateFilter = "disabled-nonpayment"
)

type UserSort string

const (
	SortEmail  UserSort = "email"
	SortJoined UserSort = "joined"
)

type UserFilterText string

type ListUsersRequest struct {
	Limit               *common.PageSize               `json:"limit,omitempty"`
	PaginationKey       *common.PaginationKey          `json:"pagination_key,omitempty"`
	FilterSearch        *UserFilterText                `json:"filter_search,omitempty"`
	FilterState         *UserStateFilter               `json:"filter_state,omitempty"`
	FilterPermission    *authorization.OrgPermissionID `json:"filter_permission,omitempty"`
	FilterNoPermissions *bool                          `json:"filter_no_permissions,omitempty"`
	SortBy              *UserSort                      `json:"sort_by,omitempty"`
	SortDescending      *bool                          `json:"sort_descending,omitempty"`
}

func (r ListUsersRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}

func (r ListUsersRequest) EffectiveSortBy() UserSort {
	if r.SortBy == nil {
		return SortEmail
	}
	return *r.SortBy
}

func (r ListUsersRequest) Descending() bool {
	return r.SortDescending != nil && *r.SortDescending
}

func (r *ListUsersRequest) Normalize() {}

func (r ListUsersRequest) Validate() []string {
	fields := make([]string, 0, 5)
	if !common.IsPageSize(r.EffectiveLimit()) {
		fields = append(fields, "limit")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.FilterSearch != nil && !IsUserFilterText(*r.FilterSearch) {
		fields = append(fields, "filter_search")
	}
	if r.FilterState != nil && !isUserStateFilter(*r.FilterState) {
		fields = append(fields, "filter_state")
	}
	if r.FilterPermission != nil &&
		!authorization.IsOrgPermission(*r.FilterPermission) {
		fields = append(fields, "filter_permission")
	}
	if r.SortBy != nil && *r.SortBy != SortEmail && *r.SortBy != SortJoined {
		fields = append(fields, "sort_by")
	}
	return fields
}

// IsUserFilterText bounds a search to at least two characters, so one letter
// never scans a whole Org.
func IsUserFilterText(value UserFilterText) bool {
	length := len([]rune(value))
	return length >= 2 && length <= 320
}

func isUserStateFilter(value UserStateFilter) bool {
	return value == FilterActive || value == FilterDisabledManual ||
		value == FilterDisabledNonpayment
}

type OrgUserSummary struct {
	EmailAddress         common.EmailAddress             `json:"email_address"`
	State                OrgUserState                    `json:"state"`
	DisabledReason       *DisabledReason                 `json:"disabled_reason,omitempty"`
	GrantedPermissions   []authorization.OrgPermissionID `json:"granted_permissions"`
	EffectivePermissions []authorization.OrgPermissionID `json:"effective_permissions"`
	JoinedAt             time.Time                       `json:"joined_at"`
	LastLoginAt          *time.Time                      `json:"last_login_at,omitempty"`
}

type ListUsersResponse struct {
	Users             []OrgUserSummary      `json:"users"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type PermissionCount struct {
	Permission authorization.OrgPermissionID `json:"permission"`
	Users      int32                         `json:"users"`
}

type UserSummaryResponse struct {
	SeatsInUse                    int32             `json:"seats_in_use"`
	SeatLimit                     *int32            `json:"seat_limit,omitempty"`
	ActiveUsers                   int32             `json:"active_users"`
	DisabledManualUsers           int32             `json:"disabled_manual_users"`
	DisabledNonpaymentUsers       int32             `json:"disabled_nonpayment_users"`
	ActiveUsersWithoutPermissions int32             `json:"active_users_without_permissions"`
	PermissionCounts              []PermissionCount `json:"permission_counts"`
}

type DisableUserRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r *DisableUserRequest) Normalize() {
	r.EmailAddress = common.NormalizeEmailAddress(r.EmailAddress)
}

func (r DisableUserRequest) Validate() []string { return validateAddress(r.EmailAddress) }

type EnableUserRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r *EnableUserRequest) Normalize() {
	r.EmailAddress = common.NormalizeEmailAddress(r.EmailAddress)
}

func (r EnableUserRequest) Validate() []string { return validateAddress(r.EmailAddress) }

func validateAddress(address common.EmailAddress) []string {
	if !common.IsEmailAddress(address) {
		return []string{"email_address"}
	}
	return []string{}
}

func normalizeAddresses(values []common.EmailAddress) []common.EmailAddress {
	normalized := make([]common.EmailAddress, len(values))
	for index, address := range values {
		normalized[index] = common.NormalizeEmailAddress(address)
	}
	return normalized
}

func validateAddresses(values []common.EmailAddress) []string {
	if !validBulk(values, common.IsEmailAddress) {
		return []string{"email_addresses"}
	}
	return []string{}
}

type BulkDisableUsersRequest struct {
	EmailAddresses []common.EmailAddress `json:"email_addresses"`
}

func (r *BulkDisableUsersRequest) Normalize() {
	r.EmailAddresses = normalizeAddresses(r.EmailAddresses)
}

func (r BulkDisableUsersRequest) Validate() []string {
	return validateAddresses(r.EmailAddresses)
}

type BulkEnableUsersRequest struct {
	EmailAddresses []common.EmailAddress `json:"email_addresses"`
}

func (r *BulkEnableUsersRequest) Normalize() {
	r.EmailAddresses = normalizeAddresses(r.EmailAddresses)
}

func (r BulkEnableUsersRequest) Validate() []string {
	return validateAddresses(r.EmailAddresses)
}

type SetUserPermissionsRequest struct {
	EmailAddress common.EmailAddress             `json:"email_address"`
	Permissions  []authorization.OrgPermissionID `json:"permissions"`
}

func (r *SetUserPermissionsRequest) Normalize() {
	r.EmailAddress = common.NormalizeEmailAddress(r.EmailAddress)
}

func (r SetUserPermissionsRequest) Validate() []string {
	fields := validateAddress(r.EmailAddress)
	if !authorization.ValidatePermissions(r.Permissions) {
		fields = append(fields, "permissions")
	}
	return fields
}

type BulkSetUserPermissionsRequest struct {
	EmailAddresses []common.EmailAddress           `json:"email_addresses"`
	Permissions    []authorization.OrgPermissionID `json:"permissions"`
}

func (r *BulkSetUserPermissionsRequest) Normalize() {
	r.EmailAddresses = normalizeAddresses(r.EmailAddresses)
}

func (r BulkSetUserPermissionsRequest) Validate() []string {
	fields := validateAddresses(r.EmailAddresses)
	if !authorization.ValidatePermissions(r.Permissions) {
		fields = append(fields, "permissions")
	}
	return fields
}
