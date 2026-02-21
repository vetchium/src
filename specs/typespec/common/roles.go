package common

import (
	"errors"
)

type RoleName string

// Valid role names matching database roles table
var ValidRoleNames = []RoleName{
	// Admin portal roles
	"admin:invite_users",
	"admin:manage_users",
	"admin:manage_domains",

	// Employer portal roles
	"employer:invite_users",
	"employer:manage_users",
	"employer:superadmin",

	// Agency portal roles
	"agency:invite_users",
	"agency:manage_users",
	"agency:superadmin",
}

// Validation errors for RBAC
var (
	ErrRoleNameInvalid      = errors.New("must be a valid role name")
	ErrTargetUserIDRequired = errors.New("target user ID is required")
)

// Validate checks if the role name is valid
func (r RoleName) Validate() error {
	for _, valid := range ValidRoleNames {
		if r == valid {
			return nil
		}
	}
	return ErrRoleNameInvalid
}

// AssignRoleRequest represents a request to assign a role to a user
type AssignRoleRequest struct {
	TargetUserID string   `json:"target_user_id"`
	RoleName     RoleName `json:"role_name"`
}

// Validate checks if the AssignRoleRequest meets all constraints
func (r AssignRoleRequest) Validate() []ValidationError {
	var errs []ValidationError

	if r.TargetUserID == "" {
		errs = append(errs, NewValidationError("target_user_id", ErrTargetUserIDRequired))
	}

	if r.RoleName == "" {
		errs = append(errs, NewValidationError("role_name", ErrRoleNameInvalid))
	} else if err := r.RoleName.Validate(); err != nil {
		errs = append(errs, NewValidationError("role_name", err))
	}

	return errs
}

// RemoveRoleRequest represents a request to remove a role from a user
type RemoveRoleRequest struct {
	TargetUserID string   `json:"target_user_id"`
	RoleName     RoleName `json:"role_name"`
}

// Validate checks if the RemoveRoleRequest meets all constraints
func (r RemoveRoleRequest) Validate() []ValidationError {
	var errs []ValidationError

	if r.TargetUserID == "" {
		errs = append(errs, NewValidationError("target_user_id", ErrTargetUserIDRequired))
	}

	if r.RoleName == "" {
		errs = append(errs, NewValidationError("role_name", ErrRoleNameInvalid))
	} else if err := r.RoleName.Validate(); err != nil {
		errs = append(errs, NewValidationError("role_name", err))
	}

	return errs
}
