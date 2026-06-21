package org

import (
	"fmt"

	"vetchium-api-server.typespec/common"
)

const (
	addressTitleMax        = 100
	addressLine1Max        = 200
	addressLine2Max        = 200
	addressCityMax         = 100
	addressStateMax        = 100
	addressPostalCodeMax   = 20
	addressCountryMax      = 100
	addressMapUrlMax       = 500
	addressMapUrlsMaxCount = 5

	errAddressTitleRequired     = "title is required"
	errAddressTitleTooLong      = "title must be at most 100 characters"
	errAddressLine1Required     = "address_line1 is required"
	errAddressLine1TooLong      = "address_line1 must be at most 200 characters"
	errAddressLine2TooLong      = "address_line2 must be at most 200 characters"
	errAddressCityRequired      = "city is required"
	errAddressCityTooLong       = "city must be at most 100 characters"
	errAddressStateTooLong      = "state must be at most 100 characters"
	errAddressPostalCodeTooLong = "postal_code must be at most 20 characters"
	errAddressCountryRequired   = "country is required"
	errAddressCountryTooLong    = "country must be at most 100 characters"
	errAddressMapUrlsTooMany    = "map_urls must have at most 5 entries"
	errAddressMapUrlTooLong     = "each map_url must be at most 500 characters"
	errAddressIDRequired        = "address_id is required"
	errAddressStatusInvalid     = "filter_status must be 'active' or 'disabled'"
)

type OrgAddressStatus string

const (
	OrgAddressStatusActive   OrgAddressStatus = "active"
	OrgAddressStatusDisabled OrgAddressStatus = "disabled"
)

type OrgAddress struct {
	AddressID    string           `json:"address_id"`
	Title        string           `json:"title"`
	AddressLine1 string           `json:"address_line1"`
	AddressLine2 *string          `json:"address_line2,omitempty"`
	City         string           `json:"city"`
	State        *string          `json:"state,omitempty"`
	PostalCode   *string          `json:"postal_code,omitempty"`
	Country      string           `json:"country"`
	MapUrls      []string         `json:"map_urls"`
	Status       OrgAddressStatus `json:"status"`
	CreatedAt    string           `json:"created_at"`
}

type CreateAddressRequest struct {
	Title        string   `json:"title"`
	AddressLine1 string   `json:"address_line1"`
	AddressLine2 *string  `json:"address_line2,omitempty"`
	City         string   `json:"city"`
	State        *string  `json:"state,omitempty"`
	PostalCode   *string  `json:"postal_code,omitempty"`
	Country      string   `json:"country"`
	MapUrls      []string `json:"map_urls,omitempty"`
}

func (r CreateAddressRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Title == "" {
		errs = append(errs, common.NewValidationError("title", fmt.Errorf(errAddressTitleRequired)))
	} else if len(r.Title) > addressTitleMax {
		errs = append(errs, common.NewValidationError("title", fmt.Errorf(errAddressTitleTooLong)))
	}
	if r.AddressLine1 == "" {
		errs = append(errs, common.NewValidationError("address_line1", fmt.Errorf(errAddressLine1Required)))
	} else if len(r.AddressLine1) > addressLine1Max {
		errs = append(errs, common.NewValidationError("address_line1", fmt.Errorf(errAddressLine1TooLong)))
	}
	if r.AddressLine2 != nil && len(*r.AddressLine2) > addressLine2Max {
		errs = append(errs, common.NewValidationError("address_line2", fmt.Errorf(errAddressLine2TooLong)))
	}
	if r.City == "" {
		errs = append(errs, common.NewValidationError("city", fmt.Errorf(errAddressCityRequired)))
	} else if len(r.City) > addressCityMax {
		errs = append(errs, common.NewValidationError("city", fmt.Errorf(errAddressCityTooLong)))
	}
	if r.State != nil && len(*r.State) > addressStateMax {
		errs = append(errs, common.NewValidationError("state", fmt.Errorf(errAddressStateTooLong)))
	}
	if r.PostalCode != nil && len(*r.PostalCode) > addressPostalCodeMax {
		errs = append(errs, common.NewValidationError("postal_code", fmt.Errorf(errAddressPostalCodeTooLong)))
	}
	if r.Country == "" {
		errs = append(errs, common.NewValidationError("country", fmt.Errorf(errAddressCountryRequired)))
	} else if len(r.Country) > addressCountryMax {
		errs = append(errs, common.NewValidationError("country", fmt.Errorf(errAddressCountryTooLong)))
	}
	if len(r.MapUrls) > addressMapUrlsMaxCount {
		errs = append(errs, common.NewValidationError("map_urls", fmt.Errorf(errAddressMapUrlsTooMany)))
	} else {
		for _, u := range r.MapUrls {
			if len(u) > addressMapUrlMax {
				errs = append(errs, common.NewValidationError("map_urls", fmt.Errorf(errAddressMapUrlTooLong)))
				break
			}
		}
	}
	return errs
}

type UpdateAddressRequest struct {
	AddressID    string   `json:"address_id"`
	Title        string   `json:"title"`
	AddressLine1 string   `json:"address_line1"`
	AddressLine2 *string  `json:"address_line2,omitempty"`
	City         string   `json:"city"`
	State        *string  `json:"state,omitempty"`
	PostalCode   *string  `json:"postal_code,omitempty"`
	Country      string   `json:"country"`
	MapUrls      []string `json:"map_urls,omitempty"`
}

func (r UpdateAddressRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.AddressID == "" {
		errs = append(errs, common.NewValidationError("address_id", fmt.Errorf(errAddressIDRequired)))
	}
	if r.Title == "" {
		errs = append(errs, common.NewValidationError("title", fmt.Errorf(errAddressTitleRequired)))
	} else if len(r.Title) > addressTitleMax {
		errs = append(errs, common.NewValidationError("title", fmt.Errorf(errAddressTitleTooLong)))
	}
	if r.AddressLine1 == "" {
		errs = append(errs, common.NewValidationError("address_line1", fmt.Errorf(errAddressLine1Required)))
	} else if len(r.AddressLine1) > addressLine1Max {
		errs = append(errs, common.NewValidationError("address_line1", fmt.Errorf(errAddressLine1TooLong)))
	}
	if r.AddressLine2 != nil && len(*r.AddressLine2) > addressLine2Max {
		errs = append(errs, common.NewValidationError("address_line2", fmt.Errorf(errAddressLine2TooLong)))
	}
	if r.City == "" {
		errs = append(errs, common.NewValidationError("city", fmt.Errorf(errAddressCityRequired)))
	} else if len(r.City) > addressCityMax {
		errs = append(errs, common.NewValidationError("city", fmt.Errorf(errAddressCityTooLong)))
	}
	if r.State != nil && len(*r.State) > addressStateMax {
		errs = append(errs, common.NewValidationError("state", fmt.Errorf(errAddressStateTooLong)))
	}
	if r.PostalCode != nil && len(*r.PostalCode) > addressPostalCodeMax {
		errs = append(errs, common.NewValidationError("postal_code", fmt.Errorf(errAddressPostalCodeTooLong)))
	}
	if r.Country == "" {
		errs = append(errs, common.NewValidationError("country", fmt.Errorf(errAddressCountryRequired)))
	} else if len(r.Country) > addressCountryMax {
		errs = append(errs, common.NewValidationError("country", fmt.Errorf(errAddressCountryTooLong)))
	}
	if len(r.MapUrls) > addressMapUrlsMaxCount {
		errs = append(errs, common.NewValidationError("map_urls", fmt.Errorf(errAddressMapUrlsTooMany)))
	} else {
		for _, u := range r.MapUrls {
			if len(u) > addressMapUrlMax {
				errs = append(errs, common.NewValidationError("map_urls", fmt.Errorf(errAddressMapUrlTooLong)))
				break
			}
		}
	}
	return errs
}

type DisableAddressRequest struct {
	AddressID string `json:"address_id"`
}

func (r DisableAddressRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.AddressID == "" {
		errs = append(errs, common.NewValidationError("address_id", fmt.Errorf(errAddressIDRequired)))
	}
	return errs
}

type EnableAddressRequest struct {
	AddressID string `json:"address_id"`
}

func (r EnableAddressRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.AddressID == "" {
		errs = append(errs, common.NewValidationError("address_id", fmt.Errorf(errAddressIDRequired)))
	}
	return errs
}

type GetAddressRequest struct {
	AddressID string `json:"address_id"`
}

func (r GetAddressRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.AddressID == "" {
		errs = append(errs, common.NewValidationError("address_id", fmt.Errorf(errAddressIDRequired)))
	}
	return errs
}

type ListAddressesRequest struct {
	FilterStatus  *OrgAddressStatus `json:"filter_status,omitempty"`
	PaginationKey *string           `json:"pagination_key,omitempty"`
	Limit         *int32            `json:"limit,omitempty"`
}

func (r ListAddressesRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.FilterStatus != nil && *r.FilterStatus != OrgAddressStatusActive && *r.FilterStatus != OrgAddressStatusDisabled {
		errs = append(errs, common.NewValidationError("filter_status", fmt.Errorf(errAddressStatusInvalid)))
	}
	return errs
}

type ListAddressesResponse struct {
	Addresses         []OrgAddress `json:"addresses"`
	NextPaginationKey string       `json:"next_pagination_key,omitempty"`
}
