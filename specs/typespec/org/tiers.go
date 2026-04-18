package org

import (
	"errors"
	"slices"

	"vetchium-api-server.typespec/common"
)

var validTierIDs = []string{"free", "silver", "gold", "enterprise"}

func isValidTierID(id string) bool {
	return slices.Contains(validTierIDs, id)
}

// OrgTier describes a platform tier with its quota caps.
type OrgTier struct {
	TierID                 string  `json:"tier_id"`
	DisplayName            string  `json:"display_name"`
	Description            string  `json:"description"`
	DisplayOrder           int32   `json:"display_order"`
	OrgUsersCap            *int32  `json:"org_users_cap,omitempty"`
	DomainsVerifiedCap     *int32  `json:"domains_verified_cap,omitempty"`
	SuborgsCap             *int32  `json:"suborgs_cap,omitempty"`
	MarketplaceListingsCap *int32  `json:"marketplace_listings_cap,omitempty"`
	AuditRetentionDays     *int32  `json:"audit_retention_days,omitempty"`
	SelfUpgradeable        bool    `json:"self_upgradeable"`
}

// OrgTierUsage holds current usage counts for quota-tracked resources.
type OrgTierUsage struct {
	OrgUsers            int32 `json:"org_users"`
	DomainsVerified     int32 `json:"domains_verified"`
	Suborgs             int32 `json:"suborgs"`
	MarketplaceListings int32 `json:"marketplace_listings"`
}

// OrgSubscription is the full subscription record with tier and usage.
type OrgSubscription struct {
	OrgID       string       `json:"org_id"`
	OrgDomain   string       `json:"org_domain"`
	CurrentTier OrgTier      `json:"current_tier"`
	Usage       OrgTierUsage `json:"usage"`
	UpdatedAt   string       `json:"updated_at"`
	Note        string       `json:"note"`
}

// ListOrgTiersRequest is the request to list all active tiers.
type ListOrgTiersRequest struct{}

func (r ListOrgTiersRequest) Validate() []common.ValidationError { return nil }

// ListOrgTiersResponse wraps the tiers list.
type ListOrgTiersResponse struct {
	Tiers []OrgTier `json:"tiers"`
}

// GetMyOrgSubscriptionRequest is the request to get the caller's org subscription.
type GetMyOrgSubscriptionRequest struct{}

func (r GetMyOrgSubscriptionRequest) Validate() []common.ValidationError { return nil }

// SelfUpgradeOrgSubscriptionRequest upgrades to the given tier.
type SelfUpgradeOrgSubscriptionRequest struct {
	TierID string `json:"tier_id"`
}

func (r SelfUpgradeOrgSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if !isValidTierID(r.TierID) {
		errs = append(errs, common.NewValidationError("tier_id", errInvalidTierID))
	}
	return errs
}

// AdminListOrgSubscriptionsRequest lists all org subscriptions (admin).
type AdminListOrgSubscriptionsRequest struct {
	FilterTierID  *string `json:"filter_tier_id,omitempty"`
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int32  `json:"limit,omitempty"`
}

func (r AdminListOrgSubscriptionsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.FilterTierID != nil && *r.FilterTierID != "" && !isValidTierID(*r.FilterTierID) {
		errs = append(errs, common.NewValidationError("filter_tier_id", errInvalidTierID))
	}
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.NewValidationError("limit", errLimitOutOfRange))
	}
	return errs
}

// AdminListOrgSubscriptionsResponse wraps the subscription list.
type AdminListOrgSubscriptionsResponse struct {
	Items           []OrgSubscription `json:"items"`
	NextPaginationKey *string         `json:"next_pagination_key,omitempty"`
}

// AdminSetOrgTierRequest sets the tier for a given org (admin).
type AdminSetOrgTierRequest struct {
	OrgID  string `json:"org_id"`
	TierID string `json:"tier_id"`
	Reason string `json:"reason"`
}

func (r AdminSetOrgTierRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgID == "" {
		errs = append(errs, common.NewValidationError("org_id", errOrgIDRequired))
	}
	if !isValidTierID(r.TierID) {
		errs = append(errs, common.NewValidationError("tier_id", errInvalidTierID))
	}
	if len(r.Reason) > 2000 {
		errs = append(errs, common.NewValidationError("reason", errReasonTooLong))
	}
	return errs
}

var (
	errInvalidTierID      = errors.New("must be a valid tier id (free, silver, gold, enterprise)")
	errLimitOutOfRange    = errors.New("must be between 1 and 100")
	errOrgIDRequired      = errors.New("org_id is required")
	errReasonTooLong      = errors.New("must be at most 2000 characters")
)
