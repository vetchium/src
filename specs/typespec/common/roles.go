package common

import (
	"errors"
)

type RoleName string

// Valid role names matching database roles table
var ValidRoleNames = []RoleName{
	// Admin portal roles
	"admin:superadmin",
	"admin:view_users",
	"admin:manage_users",
	"admin:view_domains",
	"admin:manage_domains",
	"admin:manage_tags",
	"admin:view_audit_logs",
	"admin:view_marketplace",
	"admin:manage_marketplace",

	// Org portal roles
	"org:superadmin",
	"org:view_users",
	"org:manage_users",
	"org:view_domains",
	"org:manage_domains",
	"org:view_costcenters",
	"org:manage_costcenters",
	"org:view_suborgs",
	"org:manage_suborgs",
	"org:view_listings",
	"org:manage_listings",
	"org:view_subscriptions",
	"org:manage_subscriptions",
	"org:view_audit_logs",

	// Hub portal roles
	"hub:read_posts",
	"hub:write_posts",
	"hub:apply_jobs",
}

// Validation errors for RBAC
var (
	ErrRoleNameInvalid     = errors.New("must be a valid role name")
	ErrTargetEmailRequired = errors.New("email_address is required")
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
	EmailAddress string   `json:"email_address"`
	RoleName     RoleName `json:"role_name"`
}

// Validate checks if the AssignRoleRequest meets all constraints
func (r AssignRoleRequest) Validate() []ValidationError {
	var errs []ValidationError

	if r.EmailAddress == "" {
		errs = append(errs, NewValidationError("email_address", ErrTargetEmailRequired))
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
	EmailAddress string   `json:"email_address"`
	RoleName     RoleName `json:"role_name"`
}

// Validate checks if the RemoveRoleRequest meets all constraints
func (r RemoveRoleRequest) Validate() []ValidationError {
	var errs []ValidationError

	if r.EmailAddress == "" {
		errs = append(errs, NewValidationError("email_address", ErrTargetEmailRequired))
	}

	if r.RoleName == "" {
		errs = append(errs, NewValidationError("role_name", ErrRoleNameInvalid))
	} else if err := r.RoleName.Validate(); err != nil {
		errs = append(errs, NewValidationError("role_name", err))
	}

	return errs
}
