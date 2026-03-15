package employer

import (
	"fmt"

	"vetchium-api-server.typespec/common"
)

const (
	subOrgNameMaxLength = 64

	errSubOrgNameRequired   = "name is required"
	errSubOrgNameTooLong    = "name must be at most 64 characters"
	errSubOrgIDRequired     = "suborg_id is required"
	errSubOrgRegionRequired = "pinned_region is required"
	errSubOrgEmailRequired  = "email_address is required"
)

// SubOrg is the response type for SubOrg reads.
type SubOrg struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	PinnedRegion string `json:"pinned_region"`
	Status       string `json:"status"`
	CreatedAt    string `json:"created_at"`
}

// SubOrgMember is a member of a SubOrg.
type SubOrgMember struct {
	EmailAddress string `json:"email_address"`
	Name         string `json:"name"`
	AssignedAt   string `json:"assigned_at"`
}

// CreateSubOrgRequest is the request body for POST /employer/create-suborg.
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

// ListSubOrgsRequest is the request body for POST /employer/list-suborgs.
type ListSubOrgsRequest struct {
	FilterStatus *string `json:"filter_status,omitempty"`
	Cursor       *string `json:"cursor,omitempty"`
	Limit        *int32  `json:"limit,omitempty"`
}

func (r ListSubOrgsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.FilterStatus != nil && *r.FilterStatus != "active" && *r.FilterStatus != "disabled" {
		errs = append(errs, common.NewValidationError("filter_status", fmt.Errorf("filter_status must be 'active' or 'disabled'")))
	}

	return errs
}

// ListSubOrgsResponse is the response for POST /employer/list-suborgs.
type ListSubOrgsResponse struct {
	SubOrgs    []SubOrg `json:"suborgs"`
	NextCursor string   `json:"next_cursor"`
}

// RenameSubOrgRequest is the request body for POST /employer/rename-suborg.
type RenameSubOrgRequest struct {
	SubOrgID string `json:"suborg_id"`
	Name     string `json:"name"`
}

func (r RenameSubOrgRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.SubOrgID == "" {
		errs = append(errs, common.NewValidationError("suborg_id", fmt.Errorf(errSubOrgIDRequired)))
	}

	if r.Name == "" {
		errs = append(errs, common.NewValidationError("name", fmt.Errorf(errSubOrgNameRequired)))
	} else if len(r.Name) > subOrgNameMaxLength {
		errs = append(errs, common.NewValidationError("name", fmt.Errorf(errSubOrgNameTooLong)))
	}

	return errs
}

// DisableSubOrgRequest is the request body for POST /employer/disable-suborg.
type DisableSubOrgRequest struct {
	SubOrgID string `json:"suborg_id"`
}

func (r DisableSubOrgRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.SubOrgID == "" {
		errs = append(errs, common.NewValidationError("suborg_id", fmt.Errorf(errSubOrgIDRequired)))
	}

	return errs
}

// EnableSubOrgRequest is the request body for POST /employer/enable-suborg.
type EnableSubOrgRequest struct {
	SubOrgID string `json:"suborg_id"`
}

func (r EnableSubOrgRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.SubOrgID == "" {
		errs = append(errs, common.NewValidationError("suborg_id", fmt.Errorf(errSubOrgIDRequired)))
	}

	return errs
}

// AddSubOrgMemberRequest is the request body for POST /employer/add-suborg-member.
type AddSubOrgMemberRequest struct {
	SubOrgID     string `json:"suborg_id"`
	EmailAddress string `json:"email_address"`
}

func (r AddSubOrgMemberRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.SubOrgID == "" {
		errs = append(errs, common.NewValidationError("suborg_id", fmt.Errorf(errSubOrgIDRequired)))
	}

	if r.EmailAddress == "" {
		errs = append(errs, common.NewValidationError("email_address", fmt.Errorf(errSubOrgEmailRequired)))
	}

	return errs
}

// RemoveSubOrgMemberRequest is the request body for POST /employer/remove-suborg-member.
type RemoveSubOrgMemberRequest struct {
	SubOrgID     string `json:"suborg_id"`
	EmailAddress string `json:"email_address"`
}

func (r RemoveSubOrgMemberRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.SubOrgID == "" {
		errs = append(errs, common.NewValidationError("suborg_id", fmt.Errorf(errSubOrgIDRequired)))
	}

	if r.EmailAddress == "" {
		errs = append(errs, common.NewValidationError("email_address", fmt.Errorf(errSubOrgEmailRequired)))
	}

	return errs
}

// ListSubOrgMembersRequest is the request body for POST /employer/list-suborg-members.
type ListSubOrgMembersRequest struct {
	SubOrgID string  `json:"suborg_id"`
	Cursor   *string `json:"cursor,omitempty"`
	Limit    *int32  `json:"limit,omitempty"`
}

func (r ListSubOrgMembersRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.SubOrgID == "" {
		errs = append(errs, common.NewValidationError("suborg_id", fmt.Errorf(errSubOrgIDRequired)))
	}

	return errs
}

// ListSubOrgMembersResponse is the response for POST /employer/list-suborg-members.
type ListSubOrgMembersResponse struct {
	Members    []SubOrgMember `json:"members"`
	NextCursor string         `json:"next_cursor"`
}
