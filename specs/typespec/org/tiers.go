package org

import (
	"errors"
	"slices"

	"vetchium-api-server.typespec/common"
)

var validPlanIDs = []string{"free", "silver", "gold", "enterprise"}

func isValidPlanID(id string) bool {
	return slices.Contains(validPlanIDs, id)
}

// Plan describes a platform plan with its quota caps.
type Plan struct {
	PlanID                 string `json:"plan_id"`
	DisplayName            string `json:"display_name"`
	Description            string `json:"description"`
	DisplayOrder           int32  `json:"display_order"`
	OrgUsersCap            *int32 `json:"org_users_cap,omitempty"`
	DomainsVerifiedCap     *int32 `json:"domains_verified_cap,omitempty"`
	SuborgsCap             *int32 `json:"suborgs_cap,omitempty"`
	MarketplaceListingsCap *int32 `json:"marketplace_listings_cap,omitempty"`
	AuditRetentionDays     *int32 `json:"audit_retention_days,omitempty"`
	SelfUpgradeable        bool   `json:"self_upgradeable"`
}

// PlanUsage holds current usage counts for quota-tracked resources.
type PlanUsage struct {
	OrgUsers            int32 `json:"org_users"`
	DomainsVerified     int32 `json:"domains_verified"`
	Suborgs             int32 `json:"suborgs"`
	MarketplaceListings int32 `json:"marketplace_listings"`
}

// OrgPlan is the full subscription record with plan and usage.
type OrgPlan struct {
	OrgID       string    `json:"org_id"`
	OrgDomain   string    `json:"org_domain"`
	CurrentPlan Plan      `json:"current_plan"`
	Usage       PlanUsage `json:"usage"`
	UpdatedAt   string    `json:"updated_at"`
	Note        string    `json:"note"`
}

// ListPlansRequest is the request to list all active plans.
type ListPlansRequest struct{}

func (r ListPlansRequest) Validate() []common.ValidationError { return nil }

// ListPlansResponse wraps the plans list.
type ListPlansResponse struct {
	Plans []Plan `json:"plans"`
}

// GetMyOrgPlanRequest is the request to get the caller's org plan.
type GetMyOrgPlanRequest struct{}

func (r GetMyOrgPlanRequest) Validate() []common.ValidationError { return nil }

// UpgradeOrgPlanRequest upgrades to the given plan.
type UpgradeOrgPlanRequest struct {
	PlanID string `json:"plan_id"`
}

func (r UpgradeOrgPlanRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if !isValidPlanID(r.PlanID) {
		errs = append(errs, common.NewValidationError("plan_id", errInvalidPlanID))
	}
	return errs
}

// AdminListOrgPlansRequest lists all org plans (admin).
type AdminListOrgPlansRequest struct {
	FilterPlanID  *string `json:"filter_plan_id,omitempty"`
	FilterDomain  *string `json:"filter_domain,omitempty"`
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int32  `json:"limit,omitempty"`
}

func (r AdminListOrgPlansRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.FilterPlanID != nil && *r.FilterPlanID != "" && !isValidPlanID(*r.FilterPlanID) {
		errs = append(errs, common.NewValidationError("filter_plan_id", errInvalidPlanID))
	}
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.NewValidationError("limit", errLimitOutOfRange))
	}
	return errs
}

// AdminListOrgPlansResponse wraps the plan list.
type AdminListOrgPlansResponse struct {
	Items             []OrgPlan `json:"items"`
	NextPaginationKey *string   `json:"next_pagination_key,omitempty"`
}

// AdminSetOrgPlanRequest sets the plan for a given org (admin).
type AdminSetOrgPlanRequest struct {
	OrgID  string `json:"org_id"`
	PlanID string `json:"plan_id"`
	Reason string `json:"reason"`
}

func (r AdminSetOrgPlanRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgID == "" {
		errs = append(errs, common.NewValidationError("org_id", errOrgIDRequired))
	}
	if !isValidPlanID(r.PlanID) {
		errs = append(errs, common.NewValidationError("plan_id", errInvalidPlanID))
	}
	if r.Reason == "" {
		errs = append(errs, common.NewValidationError("reason", errReasonRequired))
	} else if len(r.Reason) > 2000 {
		errs = append(errs, common.NewValidationError("reason", errReasonTooLong))
	}
	return errs
}

var (
	errInvalidPlanID   = errors.New("must be a valid plan id (free, silver, gold, enterprise)")
	errLimitOutOfRange = errors.New("must be between 1 and 100")
	errOrgIDRequired   = errors.New("org_id is required")
	errReasonRequired  = errors.New("reason is required")
	errReasonTooLong   = errors.New("must be at most 2000 characters")
)
