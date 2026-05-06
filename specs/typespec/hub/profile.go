package hub

import (
	"errors"
	"fmt"
	"time"

	"vetchium-api-server.typespec/common"
)

// ============================================================================
// Constants
// ============================================================================

const (
	ShortBioMaxLength      = 160
	LongBioMaxLength       = 4000
	CityMaxLength          = 100
	LanguageCodeMaxLength  = 35
	DisplayNamesMaxCount   = 10
)

// ============================================================================
// Structs
// ============================================================================

// HubProfileOwnerView is returned by GET /hub/get-my-profile
type HubProfileOwnerView struct {
	Handle                Handle              `json:"handle"`
	DisplayNames          []DisplayNameEntry  `json:"display_names"`
	ShortBio              *string             `json:"short_bio,omitempty"`
	LongBio               *string             `json:"long_bio,omitempty"`
	City                  *string             `json:"city,omitempty"`
	ResidentCountryCode   *CountryCode        `json:"resident_country_code,omitempty"`
	HasProfilePicture     bool                `json:"has_profile_picture"`
	PreferredLanguage     common.LanguageCode `json:"preferred_language"`
	CreatedAt             time.Time           `json:"created_at"`
	UpdatedAt             time.Time           `json:"updated_at"`
}

// HubProfilePublicView is returned by POST /hub/get-profile
type HubProfilePublicView struct {
	Handle                Handle             `json:"handle"`
	DisplayNames          []DisplayNameEntry `json:"display_names"`
	ShortBio              *string            `json:"short_bio,omitempty"`
	LongBio               *string            `json:"long_bio,omitempty"`
	City                  *string            `json:"city,omitempty"`
	ResidentCountryCode   *CountryCode       `json:"resident_country_code,omitempty"`
	ProfilePictureURL     *string            `json:"profile_picture_url,omitempty"`
}

// UpdateMyProfileRequest is the request body for POST /hub/update-my-profile
type UpdateMyProfileRequest struct {
	DisplayNames        []DisplayNameEntry `json:"display_names,omitempty"`
	ShortBio            *string           `json:"short_bio,omitempty"`
	LongBio             *string           `json:"long_bio,omitempty"`
	City                *string           `json:"city,omitempty"`
	ResidentCountryCode *CountryCode      `json:"resident_country_code,omitempty"`
}

// GetProfileRequest is the request body for POST /hub/get-profile
type GetProfileRequest struct {
	Handle Handle `json:"handle"`
}

// ============================================================================
// Validation errors
// ============================================================================

var (
	ErrShortBioTooLong  = fmt.Errorf("must be at most %d characters", ShortBioMaxLength)
	ErrLongBioTooLong   = fmt.Errorf("must be at most %d characters", LongBioMaxLength)
	ErrCityTooLong      = fmt.Errorf("must be at most %d characters", CityMaxLength)
	ErrDisplayNamesEmpty        = errors.New("at least one display name is required")
	ErrDisplayNamesTooMany      = fmt.Errorf("at most %d display names are allowed", DisplayNamesMaxCount)
	ErrDisplayNamesNotOnePreferred = errors.New("exactly one display name must be marked as preferred")
	ErrDisplayNamesDuplicateLang   = errors.New("duplicate language code")
	ErrLanguageCodeTooLong         = fmt.Errorf("must be at most %d characters", LanguageCodeMaxLength)
)

// ============================================================================
// Field validators
// ============================================================================

func ValidateShortBio(bio string) error {
	if len([]rune(bio)) > ShortBioMaxLength {
		return ErrShortBioTooLong
	}
	return nil
}

func ValidateLongBio(bio string) error {
	if len([]rune(bio)) > LongBioMaxLength {
		return ErrLongBioTooLong
	}
	return nil
}

func ValidateCity(city string) error {
	if len([]rune(city)) > CityMaxLength {
		return ErrCityTooLong
	}
	return nil
}

func ValidateDisplayNamesArray(entries []DisplayNameEntry) []common.ValidationError {
	var errs []common.ValidationError

	if len(entries) == 0 {
		errs = append(errs, common.NewValidationError("display_names", ErrDisplayNamesEmpty))
		return errs
	}

	if len(entries) > DisplayNamesMaxCount {
		errs = append(errs, common.NewValidationError("display_names", ErrDisplayNamesTooMany))
	}

	preferredCount := 0
	for _, e := range entries {
		if e.IsPreferred {
			preferredCount++
		}
	}
	if preferredCount != 1 {
		errs = append(errs, common.NewValidationError("display_names", ErrDisplayNamesNotOnePreferred))
	}

	seenLangs := make(map[string]bool)
	for idx, entry := range entries {
		if entry.LanguageCode == "" {
			errs = append(errs, common.NewValidationError(
				fmt.Sprintf("display_names[%d].language_code", idx),
				common.ErrRequired,
			))
		} else {
			if len(entry.LanguageCode) > LanguageCodeMaxLength {
				errs = append(errs, common.NewValidationError(
					fmt.Sprintf("display_names[%d].language_code", idx),
					ErrLanguageCodeTooLong,
				))
			}
			if seenLangs[entry.LanguageCode] {
				errs = append(errs, common.NewValidationError(
					fmt.Sprintf("display_names[%d].language_code", idx),
					ErrDisplayNamesDuplicateLang,
				))
			} else {
				seenLangs[entry.LanguageCode] = true
			}
		}

		if err := ValidateDisplayName(entry.DisplayName); err != nil {
			errs = append(errs, common.NewValidationError(
				fmt.Sprintf("display_names[%d].display_name", idx),
				err,
			))
		}
	}

	return errs
}

// ============================================================================
// Request validators
// ============================================================================

func (r UpdateMyProfileRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.DisplayNames != nil {
		dnErrs := ValidateDisplayNamesArray(r.DisplayNames)
		errs = append(errs, dnErrs...)
	}

	if r.ShortBio != nil {
		if err := ValidateShortBio(*r.ShortBio); err != nil {
			errs = append(errs, common.NewValidationError("short_bio", err))
		}
	}

	if r.LongBio != nil {
		if err := ValidateLongBio(*r.LongBio); err != nil {
			errs = append(errs, common.NewValidationError("long_bio", err))
		}
	}

	if r.City != nil {
		if err := ValidateCity(*r.City); err != nil {
			errs = append(errs, common.NewValidationError("city", err))
		}
	}

	if r.ResidentCountryCode != nil {
		if err := ValidateCountryCode(*r.ResidentCountryCode); err != nil {
			errs = append(errs, common.NewValidationError("resident_country_code", err))
		}
	}

	return errs
}

func (r GetProfileRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := ValidateHandle(r.Handle); err != nil {
		errs = append(errs, common.NewValidationError("handle", err))
	}

	return errs
}
