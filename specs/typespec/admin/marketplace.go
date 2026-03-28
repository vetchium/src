package admin

import (
	"fmt"

	"vetchium-api-server.typespec/common"
	orgtypes "vetchium-api-server.typespec/org"
)

// Re-export types from org package for use in admin handlers
type OrgCapabilityStatus = orgtypes.OrgCapabilityStatus
type ServiceListingState = orgtypes.ServiceListingState
type ServiceCategory = orgtypes.ServiceCategory
type OrgCapability = orgtypes.OrgCapability
type ServiceListing = orgtypes.ServiceListing

const (
	OrgCapabilityStatusPendingApproval = orgtypes.OrgCapabilityStatusPendingApproval
	OrgCapabilityStatusActive          = orgtypes.OrgCapabilityStatusActive
	OrgCapabilityStatusRejected        = orgtypes.OrgCapabilityStatusRejected
	OrgCapabilityStatusExpired         = orgtypes.OrgCapabilityStatusExpired
	OrgCapabilityStatusRevoked         = orgtypes.OrgCapabilityStatusRevoked

	ServiceListingStateDraft         = orgtypes.ServiceListingStateDraft
	ServiceListingStatePendingReview = orgtypes.ServiceListingStatePendingReview
	ServiceListingStateActive        = orgtypes.ServiceListingStateActive
	ServiceListingStatePaused        = orgtypes.ServiceListingStatePaused
	ServiceListingStateRejected      = orgtypes.ServiceListingStateRejected
	ServiceListingStateSuspended     = orgtypes.ServiceListingStateSuspended
	ServiceListingStateAppealing     = orgtypes.ServiceListingStateAppealing
	ServiceListingStateArchived      = orgtypes.ServiceListingStateArchived
)

// ---- Admin Capability endpoints ----

type ListMarketplaceProviderCapabilitiesRequest struct {
	FilterStatus *OrgCapabilityStatus `json:"filter_status,omitempty"`
	FilterOrgID  *string              `json:"filter_org_id,omitempty"`
	Cursor       *string              `json:"cursor,omitempty"`
	Limit        *int                 `json:"limit,omitempty"`
}

func (r ListMarketplaceProviderCapabilitiesRequest) Validate() []common.ValidationError {
	return nil
}

type ListMarketplaceProviderCapabilitiesResponse struct {
	Capabilities []OrgCapability `json:"capabilities"`
	NextCursor   *string         `json:"next_cursor,omitempty"`
}

type ApproveMarketplaceProviderCapabilityRequest struct {
	OrgID                  string  `json:"org_id"`
	SubscriptionPrice      float64 `json:"subscription_price"`
	Currency               string  `json:"currency"`
	SubscriptionPeriodDays int     `json:"subscription_period_days"`
}

func (r ApproveMarketplaceProviderCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgID == "" {
		errs = append(errs, common.NewValidationError("org_id", fmt.Errorf("org_id is required")))
	}
	if r.SubscriptionPrice < 0 {
		errs = append(errs, common.NewValidationError("subscription_price", fmt.Errorf("subscription_price must be non-negative")))
	}
	if len(r.Currency) != 3 {
		errs = append(errs, common.NewValidationError("currency", fmt.Errorf("currency must be a 3-letter ISO 4217 code")))
	}
	if r.SubscriptionPeriodDays <= 0 {
		errs = append(errs, common.NewValidationError("subscription_period_days", fmt.Errorf("subscription_period_days must be positive")))
	}
	return errs
}

type RejectMarketplaceProviderCapabilityRequest struct {
	OrgID     string `json:"org_id"`
	AdminNote string `json:"admin_note"`
}

func (r RejectMarketplaceProviderCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgID == "" {
		errs = append(errs, common.NewValidationError("org_id", fmt.Errorf("org_id is required")))
	}
	if r.AdminNote == "" {
		errs = append(errs, common.NewValidationError("admin_note", fmt.Errorf("admin_note is required")))
	}
	return errs
}

type RenewMarketplaceProviderCapabilityRequest struct {
	OrgID                  string  `json:"org_id"`
	SubscriptionPrice      float64 `json:"subscription_price"`
	Currency               string  `json:"currency"`
	SubscriptionPeriodDays int     `json:"subscription_period_days"`
}

func (r RenewMarketplaceProviderCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgID == "" {
		errs = append(errs, common.NewValidationError("org_id", fmt.Errorf("org_id is required")))
	}
	if r.SubscriptionPrice < 0 {
		errs = append(errs, common.NewValidationError("subscription_price", fmt.Errorf("subscription_price must be non-negative")))
	}
	if len(r.Currency) != 3 {
		errs = append(errs, common.NewValidationError("currency", fmt.Errorf("currency must be a 3-letter ISO 4217 code")))
	}
	if r.SubscriptionPeriodDays <= 0 {
		errs = append(errs, common.NewValidationError("subscription_period_days", fmt.Errorf("subscription_period_days must be positive")))
	}
	return errs
}

type RevokeMarketplaceProviderCapabilityRequest struct {
	OrgID     string `json:"org_id"`
	AdminNote string `json:"admin_note"`
}

func (r RevokeMarketplaceProviderCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgID == "" {
		errs = append(errs, common.NewValidationError("org_id", fmt.Errorf("org_id is required")))
	}
	if r.AdminNote == "" {
		errs = append(errs, common.NewValidationError("admin_note", fmt.Errorf("admin_note is required")))
	}
	return errs
}

type ReinstateMarketplaceProviderCapabilityRequest struct {
	OrgID                  string  `json:"org_id"`
	SubscriptionPrice      float64 `json:"subscription_price"`
	Currency               string  `json:"currency"`
	SubscriptionPeriodDays int     `json:"subscription_period_days"`
}

func (r ReinstateMarketplaceProviderCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgID == "" {
		errs = append(errs, common.NewValidationError("org_id", fmt.Errorf("org_id is required")))
	}
	if r.SubscriptionPrice < 0 {
		errs = append(errs, common.NewValidationError("subscription_price", fmt.Errorf("subscription_price must be non-negative")))
	}
	if len(r.Currency) != 3 {
		errs = append(errs, common.NewValidationError("currency", fmt.Errorf("currency must be a 3-letter ISO 4217 code")))
	}
	if r.SubscriptionPeriodDays <= 0 {
		errs = append(errs, common.NewValidationError("subscription_period_days", fmt.Errorf("subscription_period_days must be positive")))
	}
	return errs
}

// ---- Admin ServiceListing endpoints ----

type AdminListMarketplaceServiceListingsRequest struct {
	FilterState *ServiceListingState `json:"filter_state,omitempty"`
	FilterOrgID *string              `json:"filter_org_id,omitempty"`
	HasReports  *bool                `json:"has_reports,omitempty"`
	Cursor      *string              `json:"cursor,omitempty"`
	Limit       *int                 `json:"limit,omitempty"`
}

func (r AdminListMarketplaceServiceListingsRequest) Validate() []common.ValidationError {
	return nil
}

type AdminListMarketplaceServiceListingsResponse struct {
	ServiceListings []ServiceListing `json:"service_listings"`
	NextCursor      *string          `json:"next_cursor,omitempty"`
}

type AdminGetMarketplaceServiceListingRequest struct {
	ServiceListingID string `json:"service_listing_id"`
	HomeRegion       string `json:"home_region"`
}

func (r AdminGetMarketplaceServiceListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	if r.HomeRegion == "" {
		errs = append(errs, common.NewValidationError("home_region", fmt.Errorf("home_region is required")))
	}
	return errs
}

type AdminApproveMarketplaceServiceListingRequest struct {
	ServiceListingID       string `json:"service_listing_id"`
	HomeRegion             string `json:"home_region"`
	AdminVerificationNote  string `json:"admin_verification_note"`
	VerificationID         string `json:"verification_id"`
}

func (r AdminApproveMarketplaceServiceListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	if r.HomeRegion == "" {
		errs = append(errs, common.NewValidationError("home_region", fmt.Errorf("home_region is required")))
	}
	if r.AdminVerificationNote == "" {
		errs = append(errs, common.NewValidationError("admin_verification_note", fmt.Errorf("admin_verification_note is required")))
	}
	if r.VerificationID == "" {
		errs = append(errs, common.NewValidationError("verification_id", fmt.Errorf("verification_id is required")))
	}
	return errs
}

type AdminRejectMarketplaceServiceListingRequest struct {
	ServiceListingID      string  `json:"service_listing_id"`
	HomeRegion            string  `json:"home_region"`
	AdminVerificationNote string  `json:"admin_verification_note"`
	VerificationID        *string `json:"verification_id,omitempty"`
}

func (r AdminRejectMarketplaceServiceListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	if r.HomeRegion == "" {
		errs = append(errs, common.NewValidationError("home_region", fmt.Errorf("home_region is required")))
	}
	if r.AdminVerificationNote == "" {
		errs = append(errs, common.NewValidationError("admin_verification_note", fmt.Errorf("admin_verification_note is required")))
	}
	return errs
}

type AdminSuspendMarketplaceServiceListingRequest struct {
	ServiceListingID      string  `json:"service_listing_id"`
	HomeRegion            string  `json:"home_region"`
	AdminVerificationNote string  `json:"admin_verification_note"`
	VerificationID        *string `json:"verification_id,omitempty"`
}

func (r AdminSuspendMarketplaceServiceListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	if r.HomeRegion == "" {
		errs = append(errs, common.NewValidationError("home_region", fmt.Errorf("home_region is required")))
	}
	if r.AdminVerificationNote == "" {
		errs = append(errs, common.NewValidationError("admin_verification_note", fmt.Errorf("admin_verification_note is required")))
	}
	return errs
}

type AdminReinstateMarketplaceServiceListingRequest struct {
	ServiceListingID string  `json:"service_listing_id"`
	HomeRegion       string  `json:"home_region"`
	AdminNote        *string `json:"admin_note,omitempty"`
}

func (r AdminReinstateMarketplaceServiceListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	if r.HomeRegion == "" {
		errs = append(errs, common.NewValidationError("home_region", fmt.Errorf("home_region is required")))
	}
	return errs
}

type AdminGrantMarketplaceAppealRequest struct {
	ServiceListingID string `json:"service_listing_id"`
	HomeRegion       string `json:"home_region"`
	AdminNote        string `json:"admin_note"`
}

func (r AdminGrantMarketplaceAppealRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	if r.HomeRegion == "" {
		errs = append(errs, common.NewValidationError("home_region", fmt.Errorf("home_region is required")))
	}
	if r.AdminNote == "" {
		errs = append(errs, common.NewValidationError("admin_note", fmt.Errorf("admin_note is required")))
	}
	return errs
}

type AdminDenyMarketplaceAppealRequest struct {
	ServiceListingID string `json:"service_listing_id"`
	HomeRegion       string `json:"home_region"`
	AdminNote        string `json:"admin_note"`
}

func (r AdminDenyMarketplaceAppealRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	if r.HomeRegion == "" {
		errs = append(errs, common.NewValidationError("home_region", fmt.Errorf("home_region is required")))
	}
	if r.AdminNote == "" {
		errs = append(errs, common.NewValidationError("admin_note", fmt.Errorf("admin_note is required")))
	}
	return errs
}

// AdminRole for marketplace
const AdminRoleManageMarketplace AdminRole = "admin:manage_marketplace"
