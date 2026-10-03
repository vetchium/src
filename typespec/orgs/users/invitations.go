// Package users contains Org API user-management and invitation wire types.
package users

import (
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/authorization"
)

// MaxBulk bounds every request that targets several addresses or users.
const MaxBulk = 100

type OrgInvitationToken common.OpaqueToken
type InviteeAddress string
type InvitationFilterText string

type InviteOutcome string

const (
	Invited        InviteOutcome = "invited"
	AlreadyMember  InviteOutcome = "already-member"
	AlreadyInvited InviteOutcome = "already-invited"
	DomainMismatch InviteOutcome = "domain-mismatch"
	InvalidInvitee InviteOutcome = "invalid"
)

type InviteUsersRequest struct {
	EmailAddresses []InviteeAddress                `json:"email_addresses"`
	Permissions    []authorization.OrgPermissionID `json:"permissions,omitempty"`
}

// Normalize replaces the slice instead of rewriting the caller's.
func (r *InviteUsersRequest) Normalize() {
	normalized := make([]InviteeAddress, len(r.EmailAddresses))
	for index, address := range r.EmailAddresses {
		normalized[index] = InviteeAddress(
			common.NormalizeEmailAddress(common.EmailAddress(address)),
		)
	}
	r.EmailAddresses = normalized
}

func (r InviteUsersRequest) Validate() []string {
	fields := make([]string, 0, 2)
	if !validBulk(r.EmailAddresses, isInviteeAddress) {
		fields = append(fields, "email_addresses")
	}
	if !authorization.ValidatePermissions(r.Permissions) {
		fields = append(fields, "permissions")
	}
	return fields
}

func isInviteeAddress(value InviteeAddress) bool {
	length := len([]rune(value))
	return length >= 1 && length <= 320
}

// validBulk requires between 1 and MaxBulk valid, distinct entries.
func validBulk[T comparable](values []T, valid func(T) bool) bool {
	if len(values) < 1 || len(values) > MaxBulk {
		return false
	}
	seen := make(map[T]bool, len(values))
	for _, value := range values {
		if !valid(value) || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}

type InviteResult struct {
	EmailAddress string        `json:"email_address"`
	Outcome      InviteOutcome `json:"outcome"`
	ExpiresAt    *time.Time    `json:"expires_at,omitempty"`
}

type InviteUsersResponse struct {
	Results []InviteResult `json:"results"`
}

type ListInvitationsRequest struct {
	Limit         *common.PageSize      `json:"limit,omitempty"`
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	FilterSearch  *InvitationFilterText `json:"filter_search,omitempty"`
}

func (r ListInvitationsRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}

func (r *ListInvitationsRequest) Normalize() {}

func (r ListInvitationsRequest) Validate() []string {
	fields := make([]string, 0, 3)
	if !common.IsPageSize(r.EffectiveLimit()) {
		fields = append(fields, "limit")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.FilterSearch != nil && !IsFilterText(*r.FilterSearch) {
		fields = append(fields, "filter_search")
	}
	return fields
}

// IsFilterText bounds a search to what an index-free scan can serve: at
// least two characters, so one letter never scans a whole Org.
func IsFilterText(value InvitationFilterText) bool {
	length := len([]rune(value))
	return length >= 2 && length <= 320
}

type InvitationSummary struct {
	EmailAddress common.EmailAddress             `json:"email_address"`
	Permissions  []authorization.OrgPermissionID `json:"permissions"`
	InvitedBy    common.EmailAddress             `json:"invited_by"`
	CreatedAt    time.Time                       `json:"created_at"`
	ExpiresAt    time.Time                       `json:"expires_at"`
}

type ListInvitationsResponse struct {
	Invitations       []InvitationSummary   `json:"invitations"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type ResendInvitationRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r *ResendInvitationRequest) Normalize() {
	r.EmailAddress = common.NormalizeEmailAddress(r.EmailAddress)
}

func (r ResendInvitationRequest) Validate() []string {
	if !common.IsEmailAddress(r.EmailAddress) {
		return []string{"email_address"}
	}
	return []string{}
}

type ResendInvitationResponse struct {
	ExpiresAt time.Time `json:"expires_at"`
}

type CancelInvitationsRequest struct {
	EmailAddresses []common.EmailAddress `json:"email_addresses"`
}

func (r *CancelInvitationsRequest) Normalize() {
	normalized := make([]common.EmailAddress, len(r.EmailAddresses))
	for index, address := range r.EmailAddresses {
		normalized[index] = common.NormalizeEmailAddress(address)
	}
	r.EmailAddresses = normalized
}

func (r CancelInvitationsRequest) Validate() []string {
	if !validBulk(r.EmailAddresses, common.IsEmailAddress) {
		return []string{"email_addresses"}
	}
	return []string{}
}

type GetInvitationDetailsRequest struct {
	InvitationToken OrgInvitationToken `json:"invitation_token"`
}

func (r *GetInvitationDetailsRequest) Normalize() {}

func (r GetInvitationDetailsRequest) Validate() []string {
	if !common.IsOpaqueToken(string(r.InvitationToken)) {
		return []string{"invitation_token"}
	}
	return []string{}
}

type InvitationDetailsResponse struct {
	Domain       orgs.OrgDomain      `json:"domain"`
	EmailAddress common.EmailAddress `json:"email_address"`
	ExpiresAt    time.Time           `json:"expires_at"`
}

type AcceptInvitationRequest struct {
	InvitationToken   OrgInvitationToken  `json:"invitation_token"`
	Password          common.NewPassword  `json:"password"`
	PreferredLanguage orgs.FrontendLocale `json:"preferred_language"`
}

func (r *AcceptInvitationRequest) Normalize() {}

func (r AcceptInvitationRequest) Validate() []string {
	fields := make([]string, 0, 3)
	if !common.IsOpaqueToken(string(r.InvitationToken)) {
		fields = append(fields, "invitation_token")
	}
	if !common.IsNewPassword(r.Password) {
		fields = append(fields, "password")
	}
	if !orgs.IsFrontendLocale(r.PreferredLanguage) {
		fields = append(fields, "preferred_language")
	}
	return fields
}

type AcceptInvitationResponse struct {
	Domain       orgs.OrgDomain      `json:"domain"`
	EmailAddress common.EmailAddress `json:"email_address"`
}
