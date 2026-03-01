package admin

import (
	"fmt"
	"regexp"

	"vetchium-api-server.typespec/common"
)

var tagIDPattern = regexp.MustCompile(`^[a-z]([a-z0-9-]*[a-z0-9])?$`)

const tagIDMaxLength = 64

const (
	errTagIDRequired           = "tag_id is required"
	errTagIDTooLong            = "tag_id must be at most 64 characters"
	errTagIDInvalidFormat      = "tag_id must contain only lowercase letters, digits, and hyphens, and must not start or end with a hyphen"
	errTranslationsRequired    = "at least one translation is required"
	errEnUSTranslationRequired = "en-US translation is required"
	errDisplayNameRequired     = "display_name is required"
	errDisplayNameTooLong      = "display_name must be at most 100 characters"
	errDescriptionTooLong      = "description must be at most 500 characters"
	errLocaleRequired          = "locale is required"
	errIconSizeInvalid         = "icon_size must be 'small' or 'large'"
)

type IconSize string

const (
	IconSizeSmall IconSize = "small"
	IconSizeLarge IconSize = "large"
)

// TagTranslation holds a locale and its display name/description.
type TagTranslation struct {
	Locale      string  `json:"locale"`
	DisplayName string  `json:"display_name"`
	Description *string `json:"description,omitempty"`
}

// validateTagID validates a tag_id value and returns validation errors.
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

// validateTranslations validates a slice of TagTranslation and returns validation errors.
func validateTranslations(translations []TagTranslation) []common.ValidationError {
	var errs []common.ValidationError
	if len(translations) == 0 {
		errs = append(errs, common.NewValidationError("translations", fmt.Errorf(errTranslationsRequired)))
		return errs
	}
	hasEnUS := false
	for i, t := range translations {
		prefix := fmt.Sprintf("translations[%d]", i)
		if t.Locale == "" {
			errs = append(errs, common.NewValidationError(prefix+".locale", fmt.Errorf(errLocaleRequired)))
		} else {
			if err := common.LanguageCode(t.Locale).Validate(); err != nil {
				errs = append(errs, common.NewValidationError(prefix+".locale", err))
			}
			if t.Locale == "en-US" {
				hasEnUS = true
			}
		}
		if t.DisplayName == "" {
			errs = append(errs, common.NewValidationError(prefix+".display_name", fmt.Errorf(errDisplayNameRequired)))
		} else if len(t.DisplayName) > 100 {
			errs = append(errs, common.NewValidationError(prefix+".display_name", fmt.Errorf(errDisplayNameTooLong)))
		}
		if t.Description != nil && len(*t.Description) > 500 {
			errs = append(errs, common.NewValidationError(prefix+".description", fmt.Errorf(errDescriptionTooLong)))
		}
	}
	if !hasEnUS {
		errs = append(errs, common.NewValidationError("translations", fmt.Errorf(errEnUSTranslationRequired)))
	}
	return errs
}

// CreateTagRequest is the request body for POST /admin/add-tag.
type CreateTagRequest struct {
	TagID        string           `json:"tag_id"`
	Translations []TagTranslation `json:"translations"`
}

func (r CreateTagRequest) Validate() []common.ValidationError {
	errs := validateTagID(r.TagID)
	errs = append(errs, validateTranslations(r.Translations)...)
	return errs
}

// UpdateTagRequest is the request body for POST /admin/update-tag.
type UpdateTagRequest struct {
	TagID        string           `json:"tag_id"`
	Translations []TagTranslation `json:"translations"`
}

func (r UpdateTagRequest) Validate() []common.ValidationError {
	errs := validateTagID(r.TagID)
	errs = append(errs, validateTranslations(r.Translations)...)
	return errs
}

// GetTagRequest is the request body for POST /admin/get-tag.
type GetTagRequest struct {
	TagID string `json:"tag_id"`
}

func (r GetTagRequest) Validate() []common.ValidationError {
	return validateTagID(r.TagID)
}

// FilterTagsRequest is the request body for POST /admin/filter-tags.
type FilterTagsAdminRequest struct {
	Query         string `json:"query,omitempty"`
	PaginationKey string `json:"pagination_key,omitempty"`
}

func (r FilterTagsAdminRequest) Validate() []common.ValidationError {
	return nil
}

// DeleteTagIconRequest is the request body for POST /admin/delete-tag-icon.
type DeleteTagIconRequest struct {
	TagID    string   `json:"tag_id"`
	IconSize IconSize `json:"icon_size"`
}

func (r DeleteTagIconRequest) Validate() []common.ValidationError {
	errs := validateTagID(r.TagID)
	if r.IconSize != IconSizeSmall && r.IconSize != IconSizeLarge {
		errs = append(errs, common.NewValidationError("icon_size", fmt.Errorf(errIconSizeInvalid)))
	}
	return errs
}

// AdminTag is the response type for tag operations.
type AdminTag struct {
	TagID        string           `json:"tag_id"`
	Translations []TagTranslation `json:"translations"`
	SmallIconURL *string          `json:"small_icon_url,omitempty"`
	LargeIconURL *string          `json:"large_icon_url,omitempty"`
	CreatedAt    string           `json:"created_at"`
	UpdatedAt    string           `json:"updated_at"`
}

// FilterTagsAdminResponse is the response for POST /admin/filter-tags.
type FilterTagsAdminResponse struct {
	Tags          []AdminTag `json:"tags"`
	PaginationKey string     `json:"pagination_key,omitempty"`
}
