package org

import (
	"fmt"
	"net/mail"
	"regexp"
	"strings"

	"vetchium-api-server.typespec/common"
)

// ---- Enums ----

type MarketplaceCapabilityStatus string

const (
	MarketplaceCapabilityStatusDraft    MarketplaceCapabilityStatus = "draft"
	MarketplaceCapabilityStatusActive   MarketplaceCapabilityStatus = "active"
	MarketplaceCapabilityStatusDisabled MarketplaceCapabilityStatus = "disabled"
)

type MarketplaceListingStatus string

const (
	MarketplaceListingStatusDraft     MarketplaceListingStatus = "draft"
	MarketplaceListingStatusActive    MarketplaceListingStatus = "active"
	MarketplaceListingStatusSuspended MarketplaceListingStatus = "suspended"
	MarketplaceListingStatusArchived  MarketplaceListingStatus = "archived"
)

type MarketplaceSubscriptionStatus string

const (
	MarketplaceSubscriptionStatusActive    MarketplaceSubscriptionStatus = "active"
	MarketplaceSubscriptionStatusCancelled MarketplaceSubscriptionStatus = "cancelled"
	MarketplaceSubscriptionStatusExpired   MarketplaceSubscriptionStatus = "expired"
)

type MarketplaceContactMode string

const (
	MarketplaceContactModePlatformMessage MarketplaceContactMode = "platform_message"
	MarketplaceContactModeExternalURL     MarketplaceContactMode = "external_url"
	MarketplaceContactModeEmail           MarketplaceContactMode = "email"
)

// ---- Validation constants ----

const (
	minCapabilityIDLen     = 3
	maxCapabilityIDLen     = 50
	maxHeadlineLen         = 100
	maxSummaryLen          = 500
	maxListingDescLen      = 10000
	maxPricingHintLen      = 200
	maxRequestNoteLen      = 2000
	maxContactValueLen     = 500
)

var capabilityIDRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$`)

func validateCapabilityID(id string) error {
	if len(id) < minCapabilityIDLen {
		return fmt.Errorf("capability_id must be at least %d characters", minCapabilityIDLen)
	}
	if len(id) > maxCapabilityIDLen {
		return fmt.Errorf("capability_id must be at most %d characters", maxCapabilityIDLen)
	}
	if !capabilityIDRegex.MatchString(id) {
		return fmt.Errorf("capability_id must be lowercase alphanumeric with hyphens (not starting or ending with hyphen)")
	}
	return nil
}

func validateContactValue(mode MarketplaceContactMode, value string) error {
	if value == "" {
		return fmt.Errorf("contact_value is required")
	}
	if len(value) > maxContactValueLen {
		return fmt.Errorf("contact_value must be at most %d characters", maxContactValueLen)
	}
	switch mode {
	case MarketplaceContactModeExternalURL:
		if !strings.HasPrefix(value, "https://") {
			return fmt.Errorf("contact_value must be a valid https URL")
		}
	case MarketplaceContactModeEmail:
		if _, err := mail.ParseAddress(value); err != nil {
			return fmt.Errorf("contact_value must be a valid email address")
		}
	}
	return nil
}

// ---- Response models ----

type MarketplaceCapability struct {
	CapabilityID string                      `json:"capability_id"`
	DisplayName  string                      `json:"display_name"`
	Description  string                      `json:"description"`
	Status       MarketplaceCapabilityStatus `json:"status"`
}

type MarketplaceListing struct {
	ListingID      string                   `json:"listing_id"`
	OrgDomain      string                   `json:"org_domain"`
	CapabilityID   string                   `json:"capability_id"`
	Headline       string                   `json:"headline"`
	Summary        string                   `json:"summary"`
	Description    string                   `json:"description"`
	RegionsServed  []string                 `json:"regions_served"`
	PricingHint    *string                  `json:"pricing_hint,omitempty"`
	ContactMode    MarketplaceContactMode   `json:"contact_mode"`
	ContactValue   string                   `json:"contact_value"`
	Status         MarketplaceListingStatus `json:"status"`
	SuspensionNote *string                  `json:"suspension_note,omitempty"`
	ListedAt       *string                  `json:"listed_at,omitempty"`
	CreatedAt      string                   `json:"created_at"`
	UpdatedAt      string                   `json:"updated_at"`
}

type MarketplaceListingCard struct {
	ListingID     string                 `json:"listing_id"`
	OrgDomain     string                 `json:"org_domain"`
	CapabilityID  string                 `json:"capability_id"`
	Headline      string                 `json:"headline"`
	Summary       string                 `json:"summary"`
	RegionsServed []string               `json:"regions_served"`
	PricingHint   *string                `json:"pricing_hint,omitempty"`
	ContactMode   MarketplaceContactMode `json:"contact_mode"`
	ContactValue  string                 `json:"contact_value"`
	ListedAt      string                 `json:"listed_at"`
}

type MarketplaceSubscription struct {
	SubscriptionID  string                        `json:"subscription_id"`
	ListingID       string                        `json:"listing_id"`
	ConsumerOrgDomain string                      `json:"consumer_org_domain"`
	ProviderOrgDomain string                      `json:"provider_org_domain"`
	CapabilityID    string                        `json:"capability_id"`
	RequestNote     *string                       `json:"request_note,omitempty"`
	Status          MarketplaceSubscriptionStatus `json:"status"`
	StartedAt       string                        `json:"started_at"`
	ExpiresAt       *string                       `json:"expires_at,omitempty"`
	CancelledAt     *string                       `json:"cancelled_at,omitempty"`
	CreatedAt       string                        `json:"created_at"`
	UpdatedAt       string                        `json:"updated_at"`
}

type MarketplaceClient struct {
	SubscriptionID  string                        `json:"subscription_id"`
	ListingID       string                        `json:"listing_id"`
	ConsumerOrgDomain string                      `json:"consumer_org_domain"`
	CapabilityID    string                        `json:"capability_id"`
	RequestNote     *string                       `json:"request_note,omitempty"`
	Status          MarketplaceSubscriptionStatus `json:"status"`
	StartedAt       string                        `json:"started_at"`
	ExpiresAt       *string                       `json:"expires_at,omitempty"`
	CreatedAt       string                        `json:"created_at"`
}

// ---- Request types with Validate() ----

type ListMarketplaceCapabilitiesRequest struct {
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int    `json:"limit,omitempty"`
}

func (r ListMarketplaceCapabilitiesRequest) Validate() []common.ValidationError {
	return nil
}

type ListMarketplaceCapabilitiesResponse struct {
	Capabilities      []MarketplaceCapability `json:"capabilities"`
	NextPaginationKey *string                 `json:"next_pagination_key,omitempty"`
}

type GetMarketplaceCapabilityRequest struct {
	CapabilityID string `json:"capability_id"`
}

func (r GetMarketplaceCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateCapabilityID(r.CapabilityID); err != nil {
		errs = append(errs, common.NewValidationError("capability_id", err))
	}
	return errs
}

type ListMyListingsRequest struct {
	CapabilityID  *string `json:"capability_id,omitempty"`
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int    `json:"limit,omitempty"`
}

func (r ListMyListingsRequest) Validate() []common.ValidationError {
	return nil
}

type ListMyListingsResponse struct {
	Listings          []MarketplaceListing `json:"listings"`
	NextPaginationKey *string              `json:"next_pagination_key,omitempty"`
}

type GetMyListingRequest struct {
	ListingID string `json:"listing_id"`
}

func (r GetMyListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ListingID == "" {
		errs = append(errs, common.NewValidationError("listing_id", fmt.Errorf("listing_id is required")))
	}
	return errs
}

func validateListingFields(headline, summary, description string, regionsServed []string, pricingHint *string, contactMode MarketplaceContactMode, contactValue string) []common.ValidationError {
	var errs []common.ValidationError
	if headline == "" {
		errs = append(errs, common.NewValidationError("headline", fmt.Errorf("headline is required")))
	} else if len(headline) > maxHeadlineLen {
		errs = append(errs, common.NewValidationError("headline",
			fmt.Errorf("headline must be at most %d characters", maxHeadlineLen)))
	}
	if summary == "" {
		errs = append(errs, common.NewValidationError("summary", fmt.Errorf("summary is required")))
	} else if len(summary) > maxSummaryLen {
		errs = append(errs, common.NewValidationError("summary",
			fmt.Errorf("summary must be at most %d characters", maxSummaryLen)))
	}
	if description == "" {
		errs = append(errs, common.NewValidationError("description", fmt.Errorf("description is required")))
	} else if len(description) > maxListingDescLen {
		errs = append(errs, common.NewValidationError("description",
			fmt.Errorf("description must be at most %d characters", maxListingDescLen)))
	}
	if len(regionsServed) == 0 {
		errs = append(errs, common.NewValidationError("regions_served", fmt.Errorf("at least one region is required")))
	}
	if pricingHint != nil && len(*pricingHint) > maxPricingHintLen {
		errs = append(errs, common.NewValidationError("pricing_hint",
			fmt.Errorf("pricing_hint must be at most %d characters", maxPricingHintLen)))
	}
	if err := validateContactValue(contactMode, contactValue); err != nil {
		errs = append(errs, common.NewValidationError("contact_value", err))
	}
	return errs
}

type CreateListingRequest struct {
	CapabilityID  string                 `json:"capability_id"`
	Headline      string                 `json:"headline"`
	Summary       string                 `json:"summary"`
	Description   string                 `json:"description"`
	RegionsServed []string               `json:"regions_served"`
	PricingHint   *string                `json:"pricing_hint,omitempty"`
	ContactMode   MarketplaceContactMode `json:"contact_mode"`
	ContactValue  string                 `json:"contact_value"`
}

func (r CreateListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateCapabilityID(r.CapabilityID); err != nil {
		errs = append(errs, common.NewValidationError("capability_id", err))
	}
	errs = append(errs, validateListingFields(r.Headline, r.Summary, r.Description,
		r.RegionsServed, r.PricingHint, r.ContactMode, r.ContactValue)...)
	return errs
}

type UpdateListingRequest struct {
	ListingID     string                 `json:"listing_id"`
	Headline      string                 `json:"headline"`
	Summary       string                 `json:"summary"`
	Description   string                 `json:"description"`
	RegionsServed []string               `json:"regions_served"`
	PricingHint   *string                `json:"pricing_hint,omitempty"`
	ContactMode   MarketplaceContactMode `json:"contact_mode"`
	ContactValue  string                 `json:"contact_value"`
}

func (r UpdateListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ListingID == "" {
		errs = append(errs, common.NewValidationError("listing_id", fmt.Errorf("listing_id is required")))
	}
	errs = append(errs, validateListingFields(r.Headline, r.Summary, r.Description,
		r.RegionsServed, r.PricingHint, r.ContactMode, r.ContactValue)...)
	return errs
}

type PublishListingRequest struct {
	ListingID string `json:"listing_id"`
}

func (r PublishListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ListingID == "" {
		errs = append(errs, common.NewValidationError("listing_id", fmt.Errorf("listing_id is required")))
	}
	return errs
}

type ArchiveListingRequest struct {
	ListingID string `json:"listing_id"`
}

func (r ArchiveListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ListingID == "" {
		errs = append(errs, common.NewValidationError("listing_id", fmt.Errorf("listing_id is required")))
	}
	return errs
}

type DiscoverListingsRequest struct {
	CapabilityID  *string `json:"capability_id,omitempty"`
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int    `json:"limit,omitempty"`
}

func (r DiscoverListingsRequest) Validate() []common.ValidationError {
	return nil
}

type DiscoverListingsResponse struct {
	Listings          []MarketplaceListingCard `json:"listings"`
	NextPaginationKey *string                  `json:"next_pagination_key,omitempty"`
}

type GetListingRequest struct {
	ListingID string `json:"listing_id"`
}

func (r GetListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ListingID == "" {
		errs = append(errs, common.NewValidationError("listing_id", fmt.Errorf("listing_id is required")))
	}
	return errs
}

type RequestSubscriptionRequest struct {
	ListingID   string  `json:"listing_id"`
	RequestNote *string `json:"request_note,omitempty"`
}

func (r RequestSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ListingID == "" {
		errs = append(errs, common.NewValidationError("listing_id", fmt.Errorf("listing_id is required")))
	}
	if r.RequestNote != nil && len(*r.RequestNote) > maxRequestNoteLen {
		errs = append(errs, common.NewValidationError("request_note",
			fmt.Errorf("request_note must be at most %d characters", maxRequestNoteLen)))
	}
	return errs
}

type CancelSubscriptionRequest struct {
	SubscriptionID string `json:"subscription_id"`
}

func (r CancelSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.SubscriptionID == "" {
		errs = append(errs, common.NewValidationError("subscription_id", fmt.Errorf("subscription_id is required")))
	}
	return errs
}

type ListSubscriptionsRequest struct {
	FilterStatus  *MarketplaceSubscriptionStatus `json:"filter_status,omitempty"`
	PaginationKey *string                        `json:"pagination_key,omitempty"`
	Limit         *int                           `json:"limit,omitempty"`
}

func (r ListSubscriptionsRequest) Validate() []common.ValidationError {
	return nil
}

type ListSubscriptionsResponse struct {
	Subscriptions     []MarketplaceSubscription `json:"subscriptions"`
	NextPaginationKey *string                   `json:"next_pagination_key,omitempty"`
}

type GetSubscriptionRequest struct {
	SubscriptionID string `json:"subscription_id"`
}

func (r GetSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.SubscriptionID == "" {
		errs = append(errs, common.NewValidationError("subscription_id", fmt.Errorf("subscription_id is required")))
	}
	return errs
}

type ListClientsRequest struct {
	ListingID     *string                        `json:"listing_id,omitempty"`
	FilterStatus  *MarketplaceSubscriptionStatus `json:"filter_status,omitempty"`
	PaginationKey *string                        `json:"pagination_key,omitempty"`
	Limit         *int                           `json:"limit,omitempty"`
}

func (r ListClientsRequest) Validate() []common.ValidationError {
	return nil
}

type ListClientsResponse struct {
	Clients           []MarketplaceClient `json:"clients"`
	NextPaginationKey *string             `json:"next_pagination_key,omitempty"`
}

type GetClientRequest struct {
	SubscriptionID string `json:"subscription_id"`
}

func (r GetClientRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.SubscriptionID == "" {
		errs = append(errs, common.NewValidationError("subscription_id", fmt.Errorf("subscription_id is required")))
	}
	return errs
}
