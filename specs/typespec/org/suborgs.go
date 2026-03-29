package org

import (
	"fmt"

	"vetchium-api-server.typespec/common"
)

const (
	subOrgNameMaxLength = 64

	errSubOrgNameRequired    = "name is required"
	errSubOrgNameTooLong     = "name must be at most 64 characters"
	errSubOrgNewNameRequired = "new_name is required"
	errSubOrgNewNameTooLong  = "new_name must be at most 64 characters"
	errSubOrgRegionRequired  = "pinned_region is required"
	errSubOrgEmailRequired   = "email_address is required"
)

// SubOrg is the response type for SubOrg reads.
type SubOrg struct {
	Name         string `json:"name"`
	PinnedRegion string `json:"pinned_region"`
	Status       string `json:"status"`
	CreatedAt    string `json:"created_at"`
}

// SubOrgMember is a member of a SubOrg.
type SubOrgMember struct {
	EmailAddress string  `json:"email_address"`
	FullName     *string `json:"full_name,omitempty"`
	AssignedAt   string  `json:"assigned_at"`
}

// CreateSubOrgRequest is the request body for POST /org/create-suborg.
type CreateSubOrgRequest struct {
	Name         string `json:"name"`
	PinnedRegion string `json:"pinned_region"`
}

func (r CreateSubOrgRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Name == "" {
		errs = append(errs, common.NewValidationError("name", fmt.Errorf(errSubOrgNameRequired)))
	} else if len(r.Name) > subOrgNameMaxLength {
		errs = append(errs, common.NewValidationError("name", fmt.Errorf(errSubOrgNameTooLong)))
	}

	if r.PinnedRegion == "" {
		errs = append(errs, common.NewValidationError("pinned_region", fmt.Errorf(errSubOrgRegionRequired)))
	}

	return errs
}

// ListSubOrgsRequest is the request body for POST /org/list-suborgs.
type ListSubOrgsRequest struct {
	FilterStatus  *string `json:"filter_status,omitempty"`
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int    `json:"limit,omitempty"`
}

func (r ListSubOrgsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.FilterStatus != nil && *r.FilterStatus != "active" && *r.FilterStatus != "disabled" {
		errs = append(errs, common.NewValidationError("filter_status", fmt.Errorf("filter_status must be 'active' or 'disabled'")))
	}

	return errs
}

// ListSubOrgsResponse is the response for POST /org/list-suborgs.
type ListSubOrgsResponse struct {
	SubOrgs           []SubOrg `json:"suborgs"`
	NextPaginationKey string   `json:"next_pagination_key"`
}

// RenameSubOrgRequest is the request body for POST /org/rename-suborg.
type RenameSubOrgRequest struct {
	Name    string `json:"name"`
	NewName string `json:"new_name"`
}

func (r RenameSubOrgRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Name == "" {
		errs = append(errs, common.NewValidationError("name", fmt.Errorf(errSubOrgNameRequired)))
	} else if len(r.Name) > subOrgNameMaxLength {
		errs = append(errs, common.NewValidationError("name", fmt.Errorf(errSubOrgNameTooLong)))
	}

	if r.NewName == "" {
		errs = append(errs, common.NewValidationError("new_name", fmt.Errorf(errSubOrgNewNameRequired)))
	} else if len(r.NewName) > subOrgNameMaxLength {
		errs = append(errs, common.NewValidationError("new_name", fmt.Errorf(errSubOrgNewNameTooLong)))
	}

	return errs
}

// DisableSubOrgRequest is the request body for POST /org/disable-suborg.
type DisableSubOrgRequest struct {
	Name string `json:"name"`
}

func (r DisableSubOrgRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Name == "" {
		errs = append(errs, common.NewValidationError("name", fmt.Errorf(errSubOrgNameRequired)))
	}

	return errs
}

// EnableSubOrgRequest is the request body for POST /org/enable-suborg.
type EnableSubOrgRequest struct {
	Name string `json:"name"`
}

func (r EnableSubOrgRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Name == "" {
		errs = append(errs, common.NewValidationError("name", fmt.Errorf(errSubOrgNameRequired)))
	}

	return errs
}

// AddSubOrgMemberRequest is the request body for POST /org/add-suborg-member.
type AddSubOrgMemberRequest struct {
	Name         string `json:"name"`
	EmailAddress string `json:"email_address"`
}

func (r AddSubOrgMemberRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Name == "" {
		errs = append(errs, common.NewValidationError("name", fmt.Errorf(errSubOrgNameRequired)))
	}

	if r.EmailAddress == "" {
		errs = append(errs, common.NewValidationError("email_address", fmt.Errorf(errSubOrgEmailRequired)))
	}

	return errs
}

// RemoveSubOrgMemberRequest is the request body for POST /org/remove-suborg-member.
type RemoveSubOrgMemberRequest struct {
	Name         string `json:"name"`
	EmailAddress string `json:"email_address"`
}

func (r RemoveSubOrgMemberRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Name == "" {
		errs = append(errs, common.NewValidationError("name", fmt.Errorf(errSubOrgNameRequired)))
	}

	if r.EmailAddress == "" {
		errs = append(errs, common.NewValidationError("email_address", fmt.Errorf(errSubOrgEmailRequired)))
	}

	return errs
}

// ListSubOrgMembersRequest is the request body for POST /org/list-suborg-members.
type ListSubOrgMembersRequest struct {
	Name          string  `json:"name"`
	PaginationKey *string `json:"pagination_key,omitempty"`
}

func (r ListSubOrgMembersRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Name == "" {
		errs = append(errs, common.NewValidationError("name", fmt.Errorf(errSubOrgNameRequired)))
	}

	return errs
}

// ListSubOrgMembersResponse is the response for POST /org/list-suborg-members.
type ListSubOrgMembersResponse struct {
	Members           []SubOrgMember `json:"members"`
	NextPaginationKey string         `json:"next_pagination_key"`
}
