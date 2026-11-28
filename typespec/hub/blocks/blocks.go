package blocks

import (
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/hub/profile"
)

const (
	DefaultLimit = 20
	MaxLimit     = 50
)

// BlockUserRequest names the other user for block, unblock, mute, unmute,
// and state.
type BlockUserRequest struct {
	User profile.ProfileAddress `json:"user"`
}

func (r *BlockUserRequest) Normalize() {
	r.User = profile.ProfileAddress(strings.TrimSpace(string(r.User)))
}

func (r BlockUserRequest) Validate() []string {
	if !profile.IsProfileAddress(r.User) {
		return []string{"user"}
	}
	return []string{}
}

func validPage(key *common.PaginationKey, limit *int32) []string {
	fields := []string{}
	if key != nil && !common.IsPaginationKey(*key) {
		fields = append(fields, "pagination_key")
	}
	if limit != nil && (*limit < 1 || *limit > MaxLimit) {
		fields = append(fields, "limit")
	}
	return fields
}

func effectiveLimit(limit *int32) int32 {
	if limit == nil {
		return DefaultLimit
	}
	return *limit
}

type ListBlockedUsersRequest struct {
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *int32                `json:"limit,omitempty"`
}

func (r *ListBlockedUsersRequest) Normalize() {}

func (r ListBlockedUsersRequest) EffectiveLimit() int32 {
	return effectiveLimit(r.Limit)
}

func (r ListBlockedUsersRequest) Validate() []string {
	return validPage(r.PaginationKey, r.Limit)
}

type BlockedUser struct {
	Handle    hub.HubHandle `json:"handle"`
	CreatedAt time.Time     `json:"created_at"`
}

type ListBlockedUsersResponse struct {
	Users             []BlockedUser         `json:"users"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type ListMutedUsersRequest struct {
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *int32                `json:"limit,omitempty"`
}

func (r *ListMutedUsersRequest) Normalize() {}

func (r ListMutedUsersRequest) EffectiveLimit() int32 {
	return effectiveLimit(r.Limit)
}

func (r ListMutedUsersRequest) Validate() []string {
	return validPage(r.PaginationKey, r.Limit)
}

type MutedUser struct {
	Handle    hub.HubHandle `json:"handle"`
	CreatedAt time.Time     `json:"created_at"`
}

type ListMutedUsersResponse struct {
	Users             []MutedUser           `json:"users"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

// BlockState tells whether the caller blocked and muted one user.
type BlockState struct {
	Blocked bool `json:"blocked"`
	Muted   bool `json:"muted"`
}

// CheckBlockRequest asks the blocker's tenant whether the blocker blocked the
// viewer. The viewer is the blocked user. The local Hub API fills the viewer
// fields from its authenticated session.
type CheckBlockRequest struct {
	BlockerHubUserDID hub.HubUserDID `json:"blocker_hub_user_did"`
	BlockedHubUserDID hub.HubUserDID `json:"blocked_hub_user_did"`
	ViewerHandle      hub.HubHandle  `json:"viewer_handle"`
}

func (r *CheckBlockRequest) Normalize() {}

func (r CheckBlockRequest) Validate() []string {
	fields := []string{}
	if !hub.IsHubUserDID(r.BlockerHubUserDID) {
		fields = append(fields, "blocker_hub_user_did")
	}
	if !hub.IsHubUserDID(r.BlockedHubUserDID) {
		fields = append(fields, "blocked_hub_user_did")
	}
	if !hub.IsHubHandle(r.ViewerHandle) {
		fields = append(fields, "viewer_handle")
	}
	return fields
}

type CheckBlockResponse struct {
	Blocked bool `json:"blocked"`
}
