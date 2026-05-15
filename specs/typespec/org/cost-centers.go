package org

import (
	"fmt"
	"regexp"

	"vetchium-api-server.typespec/common"
)

const (
	costCenterIDMaxLength          = 64
	costCenterDisplayNameMaxLength = 64
	costCenterNotesMaxLength       = 500

	errCostCenterIDRequired          = "id is required"
	errCostCenterIDTooLong           = "id must be at most 64 characters"
	errCostCenterIDInvalid           = "id must only contain lowercase letters, numbers, hyphens, and underscores, and must start with a letter or number"
	errCostCenterDisplayNameRequired = "display_name is required"
	errCostCenterDisplayNameTooLong  = "display_name must be at most 64 characters"
	errCostCenterNotesTooLong        = "notes must be at most 500 characters"
	errCostCenterStatusInvalid       = "status must be 'enabled' or 'disabled'"
)

var costCenterIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

type CostCenterStatus string

const (
	CostCenterStatusEnabled  CostCenterStatus = "enabled"
	CostCenterStatusDisabled CostCenterStatus = "disabled"
)

// CostCenter is the response type for cost center reads.
type CostCenter struct {
	CostCenterID string           `json:"cost_center_id"`
	DisplayName  string           `json:"display_name"`
	Status       CostCenterStatus `json:"status"`
	Notes        *string          `json:"notes,omitempty"`
	CreatedAt    string           `json:"created_at"`
}

// AddCostCenterRequest is the request body for POST /org/create-cost-center.
type AddCostCenterRequest struct {
	CostCenterID string  `json:"cost_center_id"`
	DisplayName  string  `json:"display_name"`
	Notes        *string `json:"notes,omitempty"`
}

func (r AddCostCenterRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.CostCenterID == "" {
		errs = append(errs, common.NewValidationError("cost_center_id", fmt.Errorf(errCostCenterIDRequired)))
		return errs
	}
	if len(r.CostCenterID) > costCenterIDMaxLength {
		errs = append(errs, common.NewValidationError("cost_center_id", fmt.Errorf(errCostCenterIDTooLong)))
	} else if !costCenterIDPattern.MatchString(r.CostCenterID) {
		errs = append(errs, common.NewValidationError("cost_center_id", fmt.Errorf(errCostCenterIDInvalid)))
	}

	if r.DisplayName == "" {
		errs = append(errs, common.NewValidationError("display_name", fmt.Errorf(errCostCenterDisplayNameRequired)))
	} else if len(r.DisplayName) > costCenterDisplayNameMaxLength {
		errs = append(errs, common.NewValidationError("display_name", fmt.Errorf(errCostCenterDisplayNameTooLong)))
	}

	if r.Notes != nil && len(*r.Notes) > costCenterNotesMaxLength {
		errs = append(errs, common.NewValidationError("notes", fmt.Errorf(errCostCenterNotesTooLong)))
	}

	return errs
}

// UpdateCostCenterRequest is the request body for POST /org/update-cost-center.
type UpdateCostCenterRequest struct {
	CostCenterID string           `json:"cost_center_id"`
	DisplayName  string           `json:"display_name"`
	Status       CostCenterStatus `json:"status"`
	Notes        *string          `json:"notes,omitempty"`
}

func (r UpdateCostCenterRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.CostCenterID == "" {
		errs = append(errs, common.NewValidationError("cost_center_id", fmt.Errorf(errCostCenterIDRequired)))
		return errs
	}
	if len(r.CostCenterID) > costCenterIDMaxLength {
		errs = append(errs, common.NewValidationError("cost_center_id", fmt.Errorf(errCostCenterIDTooLong)))
	} else if !costCenterIDPattern.MatchString(r.CostCenterID) {
		errs = append(errs, common.NewValidationError("cost_center_id", fmt.Errorf(errCostCenterIDInvalid)))
	}

	if r.DisplayName == "" {
		errs = append(errs, common.NewValidationError("display_name", fmt.Errorf(errCostCenterDisplayNameRequired)))
	} else if len(r.DisplayName) > costCenterDisplayNameMaxLength {
		errs = append(errs, common.NewValidationError("display_name", fmt.Errorf(errCostCenterDisplayNameTooLong)))
	}

	if r.Status == "" {
		errs = append(errs, common.NewValidationError("status", fmt.Errorf(errCostCenterStatusInvalid)))
	} else if r.Status != CostCenterStatusEnabled && r.Status != CostCenterStatusDisabled {
		errs = append(errs, common.NewValidationError("status", fmt.Errorf(errCostCenterStatusInvalid)))
	}

	if r.Notes != nil && len(*r.Notes) > costCenterNotesMaxLength {
		errs = append(errs, common.NewValidationError("notes", fmt.Errorf(errCostCenterNotesTooLong)))
	}

	return errs
}

// ListCostCentersRequest is the request body for POST /org/list-cost-centers.
type ListCostCentersRequest struct {
	PaginationKey *string           `json:"pagination_key,omitempty"`
	FilterStatus  *CostCenterStatus `json:"filter_status,omitempty"`
	Limit         *int32            `json:"limit,omitempty"`
}

func (r ListCostCentersRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.FilterStatus != nil && *r.FilterStatus != CostCenterStatusEnabled && *r.FilterStatus != CostCenterStatusDisabled {
		errs = append(errs, common.NewValidationError("filter_status", fmt.Errorf(errCostCenterStatusInvalid)))
	}

	return errs
}

// ListCostCentersResponse is the response for POST /org/list-cost-centers.
type ListCostCentersResponse struct {
	CostCenters       []CostCenter `json:"cost_centers"`
	NextPaginationKey *string      `json:"next_pagination_key,omitempty"`
}
