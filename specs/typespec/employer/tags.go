package employer

import (
	"fmt"
	"regexp"

	"vetchium-api-server.typespec/common"
)

var tagIDPattern = regexp.MustCompile(`^[a-z]([a-z0-9-]*[a-z0-9])?$`)

const tagIDMaxLength = 64

const (
	errTagIDRequired      = "tag_id is required"
	errTagIDTooLong       = "tag_id must be at most 64 characters"
	errTagIDInvalidFormat = "tag_id must contain only lowercase letters, digits, and hyphens, and must not start or end with a hyphen"
)

// GetTagRequest is the request body for POST /employer/get-tag.
type GetTagRequest struct {
	TagID  string `json:"tag_id"`
	Locale string `json:"locale,omitempty"`
}

func (r GetTagRequest) Validate() []common.ValidationError {
	return validateTagID(r.TagID)
}

// FilterTagsRequest is the request body for POST /employer/filter-tags.
type FilterTagsRequest struct {
	Query         string `json:"query,omitempty"`
	PaginationKey string `json:"pagination_key,omitempty"`
	Locale        string `json:"locale,omitempty"`
}

func (r FilterTagsRequest) Validate() []common.ValidationError {
	return nil
}

// Tag is the response type for portal tag reads.
type Tag struct {
	TagID        string  `json:"tag_id"`
	DisplayName  string  `json:"display_name"`
	Description  *string `json:"description,omitempty"`
	SmallIconURL *string `json:"small_icon_url,omitempty"`
	LargeIconURL *string `json:"large_icon_url,omitempty"`
}

// FilterTagsResponse is the response for POST /employer/filter-tags.
type FilterTagsResponse struct {
	Tags          []Tag  `json:"tags"`
	PaginationKey string `json:"pagination_key,omitempty"`
}

func validateTagID(tagID string) []common.ValidationError {
	var errs []common.ValidationError
	if tagID == "" {
		errs = append(errs, common.NewValidationError("tag_id", fmt.Errorf(errTagIDRequired)))
		return errs
	}
	if len(tagID) > tagIDMaxLength {
		errs = append(errs, common.NewValidationError("tag_id", fmt.Errorf(errTagIDTooLong)))
		return errs
	}
	if !tagIDPattern.MatchString(tagID) {
		errs = append(errs, common.NewValidationError("tag_id", fmt.Errorf(errTagIDInvalidFormat)))
	}
	return errs
}
