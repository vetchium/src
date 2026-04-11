package admin

import (
	"fmt"
	"regexp"

	"vetchium-api-server.typespec/common"
	org "vetchium-api-server.typespec/org"
)

// ---- Admin Role constants ----

const AdminRoleViewMarketplace AdminRole = "admin:view_marketplace"
const AdminRoleManageMarketplace AdminRole = "admin:manage_marketplace"

// ---- Validation helpers ----

var adminCapabilityIDRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$`)

const (
	adminMinCapabilityIDLen = 3
	adminMaxCapabilityIDLen = 50
	adminMaxDisplayNameLen  = 100
	adminMaxDescriptionLen  = 5000
	adminMaxSuspensionNote  = 2000
)

func validateAdminCapabilityID(id string) error {
	if len(id) < adminMinCapabilityIDLen {
		return fmt.Errorf("capability_id must be at least %d characters", adminMinCapabilityIDLen)
	}
	if len(id) > adminMaxCapabilityIDLen {
		return fmt.Errorf("capability_id must be at most %d characters", adminMaxCapabilityIDLen)
	}
	if !adminCapabilityIDRegex.MatchString(id) {
		return fmt.Errorf("capability_id must be lowercase alphanumeric with hyphens (not starting or ending with hyphen)")
	}
	return nil
}

// ---- Models ----

type AdminCapabilityTranslation struct {
	Locale      string `json:"locale"`
	DisplayName string `json:"display_name"`
	Description string `json:"description"`
}

type AdminMarketplaceCapability struct {
	CapabilityID string                          `json:"capability_id"`
	Status       org.MarketplaceCapabilityStatus `json:"status"`
	Translations []AdminCapabilityTranslation    `json:"translations"`
	CreatedAt    string                          `json:"created_at"`
	UpdatedAt    string                          `json:"updated_at"`
}

type AdminMarketplaceListing struct {
	ListingID      string                       `json:"listing_id"`
	OrgDomain      string                       `json:"org_domain"`
	CapabilityID   string                       `json:"capability_id"`
	Headline       string                       `json:"headline"`
	Summary        string                       `json:"summary"`
	Description    string                       `json:"description"`
	RegionsServed  []string                     `json:"regions_served"`
	PricingHint    *string                      `json:"pricing_hint,omitempty"`
	ContactMode    org.MarketplaceContactMode   `json:"contact_mode"`
	ContactValue   string                       `json:"contact_value"`
	Status         org.MarketplaceListingStatus `json:"status"`
	SuspensionNote *string                      `json:"suspension_note,omitempty"`
	ListedAt       *string                      `json:"listed_at,omitempty"`
	CreatedAt      string                       `json:"created_at"`
	UpdatedAt      string                       `json:"updated_at"`
}

type AdminMarketplaceSubscription struct {
	SubscriptionID    string                            `json:"subscription_id"`
	ListingID         string                            `json:"listing_id"`
	ConsumerOrgDomain string                            `json:"consumer_org_domain"`
	ProviderOrgDomain string                            `json:"provider_org_domain"`
	CapabilityID      string                            `json:"capability_id"`
	RequestNote       *string                           `json:"request_note,omitempty"`
	Status            org.MarketplaceSubscriptionStatus `json:"status"`
	StartedAt         string                            `json:"started_at"`
	ExpiresAt         *string                           `json:"expires_at,omitempty"`
	CancelledAt       *string                           `json:"cancelled_at,omitempty"`
	CreatedAt         string                            `json:"created_at"`
	UpdatedAt         string                            `json:"updated_at"`
}

// ---- Request types with Validate() ----

type AdminListCapabilitiesRequest struct {
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int    `json:"limit,omitempty"`
}

func (r AdminListCapabilitiesRequest) Validate() []common.ValidationError {
	return nil
}

type AdminListCapabilitiesResponse struct {
	Capabilities      []AdminMarketplaceCapability `json:"capabilities"`
	NextPaginationKey *string                      `json:"next_pagination_key,omitempty"`
}

type AdminGetCapabilityRequest struct {
	CapabilityID string `json:"capability_id"`
}

func (r AdminGetCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateAdminCapabilityID(r.CapabilityID); err != nil {
		errs = append(errs, common.NewValidationError("capability_id", err))
	}
	return errs
}

func validateCapabilityTranslations(translations []AdminCapabilityTranslation) []common.ValidationError {
	var errs []common.ValidationError
	if len(translations) == 0 {
		errs = append(errs, common.NewValidationError("translations", fmt.Errorf("at least one translation is required")))
		return errs
	}
	hasEnUS := false
	for i, t := range translations {
		if t.Locale == "en-US" {
			hasEnUS = true
		}
		if t.DisplayName == "" {
			errs = append(errs, common.NewValidationError(fmt.Sprintf("translations[%d].display_name", i),
				fmt.Errorf("display_name is required")))
		} else if len(t.DisplayName) > adminMaxDisplayNameLen {
			errs = append(errs, common.NewValidationError(fmt.Sprintf("translations[%d].display_name", i),
				fmt.Errorf("display_name must be at most %d characters", adminMaxDisplayNameLen)))
		}
		if len(t.Description) > adminMaxDescriptionLen {
			errs = append(errs, common.NewValidationError(fmt.Sprintf("translations[%d].description", i),
				fmt.Errorf("description must be at most %d characters", adminMaxDescriptionLen)))
		}
	}
	if !hasEnUS {
		errs = append(errs, common.NewValidationError("translations", fmt.Errorf("en-US translation is required")))
	}
	return errs
}

type AdminCreateCapabilityRequest struct {
	CapabilityID string                          `json:"capability_id"`
	Status       org.MarketplaceCapabilityStatus `json:"status"`
	Translations []AdminCapabilityTranslation    `json:"translations"`
}

func (r AdminCreateCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateAdminCapabilityID(r.CapabilityID); err != nil {
		errs = append(errs, common.NewValidationError("capability_id", err))
	}
	errs = append(errs, validateCapabilityTranslations(r.Translations)...)
	return errs
}

type AdminUpdateCapabilityRequest struct {
	CapabilityID string                       `json:"capability_id"`
	Translations []AdminCapabilityTranslation `json:"translations"`
}

func (r AdminUpdateCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateAdminCapabilityID(r.CapabilityID); err != nil {
		errs = append(errs, common.NewValidationError("capability_id", err))
	}
	errs = append(errs, validateCapabilityTranslations(r.Translations)...)
	return errs
}

type AdminEnableCapabilityRequest struct {
	CapabilityID string `json:"capability_id"`
}

func (r AdminEnableCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateAdminCapabilityID(r.CapabilityID); err != nil {
		errs = append(errs, common.NewValidationError("capability_id", err))
	}
	return errs
}

type AdminDisableCapabilityRequest struct {
	CapabilityID string `json:"capability_id"`
}

func (r AdminDisableCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateAdminCapabilityID(r.CapabilityID); err != nil {
		errs = append(errs, common.NewValidationError("capability_id", err))
	}
	return errs
}

type AdminListListingsRequest struct {
	CapabilityID  *string                       `json:"capability_id,omitempty"`
	OrgDomain     *string                       `json:"org_domain,omitempty"`
	FilterStatus  *org.MarketplaceListingStatus `json:"filter_status,omitempty"`
	PaginationKey *string                       `json:"pagination_key,omitempty"`
	Limit         *int                          `json:"limit,omitempty"`
}

func (r AdminListListingsRequest) Validate() []common.ValidationError {
	return nil
}

type AdminListListingsResponse struct {
	Listings          []AdminMarketplaceListing `json:"listings"`
	NextPaginationKey *string                   `json:"next_pagination_key,omitempty"`
}

type AdminGetListingRequest struct {
	ListingID string `json:"listing_id"`
}

func (r AdminGetListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ListingID == "" {
		errs = append(errs, common.NewValidationError("listing_id", fmt.Errorf("listing_id is required")))
	}
	return errs
}

type AdminSuspendListingRequest struct {
	ListingID      string `json:"listing_id"`
	SuspensionNote string `json:"suspension_note"`
}

func (r AdminSuspendListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ListingID == "" {
		errs = append(errs, common.NewValidationError("listing_id", fmt.Errorf("listing_id is required")))
	}
	if r.SuspensionNote == "" {
		errs = append(errs, common.NewValidationError("suspension_note", fmt.Errorf("suspension_note is required")))
	} else if len(r.SuspensionNote) > adminMaxSuspensionNote {
		errs = append(errs, common.NewValidationError("suspension_note",
			fmt.Errorf("suspension_note must be at most %d characters", adminMaxSuspensionNote)))
	}
	return errs
}

type AdminReinstateListingRequest struct {
	ListingID string `json:"listing_id"`
}

func (r AdminReinstateListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ListingID == "" {
		errs = append(errs, common.NewValidationError("listing_id", fmt.Errorf("listing_id is required")))
	}
	return errs
}

type AdminListSubscriptionsRequest struct {
	CapabilityID  *string                            `json:"capability_id,omitempty"`
	OrgDomain     *string                            `json:"org_domain,omitempty"`
	FilterStatus  *org.MarketplaceSubscriptionStatus `json:"filter_status,omitempty"`
	PaginationKey *string                            `json:"pagination_key,omitempty"`
	Limit         *int                               `json:"limit,omitempty"`
}

func (r AdminListSubscriptionsRequest) Validate() []common.ValidationError {
	return nil
}

type AdminListSubscriptionsResponse struct {
	Subscriptions     []AdminMarketplaceSubscription `json:"subscriptions"`
	NextPaginationKey *string                        `json:"next_pagination_key,omitempty"`
}

type AdminGetSubscriptionRequest struct {
	SubscriptionID string `json:"subscription_id"`
}

func (r AdminGetSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.SubscriptionID == "" {
		errs = append(errs, common.NewValidationError("subscription_id", fmt.Errorf("subscription_id is required")))
	}
	return errs
}

type AdminCancelSubscriptionRequest struct {
	SubscriptionID string `json:"subscription_id"`
}

func (r AdminCancelSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.SubscriptionID == "" {
		errs = append(errs, common.NewValidationError("subscription_id", fmt.Errorf("subscription_id is required")))
	}
	return errs
}
