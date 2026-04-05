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

type MarketplaceEnrollmentStatus string

const (
	MarketplaceEnrollmentStatusPendingReview MarketplaceEnrollmentStatus = "pending_review"
	MarketplaceEnrollmentStatusApproved      MarketplaceEnrollmentStatus = "approved"
	MarketplaceEnrollmentStatusRejected      MarketplaceEnrollmentStatus = "rejected"
	MarketplaceEnrollmentStatusSuspended     MarketplaceEnrollmentStatus = "suspended"
	MarketplaceEnrollmentStatusExpired       MarketplaceEnrollmentStatus = "expired"
)

type MarketplaceOfferStatus string

const (
	MarketplaceOfferStatusDraft         MarketplaceOfferStatus = "draft"
	MarketplaceOfferStatusPendingReview MarketplaceOfferStatus = "pending_review"
	MarketplaceOfferStatusActive        MarketplaceOfferStatus = "active"
	MarketplaceOfferStatusRejected      MarketplaceOfferStatus = "rejected"
	MarketplaceOfferStatusSuspended     MarketplaceOfferStatus = "suspended"
	MarketplaceOfferStatusArchived      MarketplaceOfferStatus = "archived"
)

type MarketplaceSubscriptionStatus string

const (
	MarketplaceSubscriptionStatusRequested        MarketplaceSubscriptionStatus = "requested"
	MarketplaceSubscriptionStatusProviderReview   MarketplaceSubscriptionStatus = "provider_review"
	MarketplaceSubscriptionStatusAdminReview      MarketplaceSubscriptionStatus = "admin_review"
	MarketplaceSubscriptionStatusAwaitingContract MarketplaceSubscriptionStatus = "awaiting_contract"
	MarketplaceSubscriptionStatusAwaitingPayment  MarketplaceSubscriptionStatus = "awaiting_payment"
	MarketplaceSubscriptionStatusActive           MarketplaceSubscriptionStatus = "active"
	MarketplaceSubscriptionStatusRejected         MarketplaceSubscriptionStatus = "rejected"
	MarketplaceSubscriptionStatusCancelled        MarketplaceSubscriptionStatus = "cancelled"
	MarketplaceSubscriptionStatusExpired          MarketplaceSubscriptionStatus = "expired"
)

type MarketplaceContactMode string

const (
	MarketplaceContactModePlatformMessage MarketplaceContactMode = "platform_message"
	MarketplaceContactModeExternalURL     MarketplaceContactMode = "external_url"
	MarketplaceContactModeEmail           MarketplaceContactMode = "email"
)

// ---- Validation constants ----

const (
	minCapabilitySlugLen   = 3
	maxCapabilitySlugLen   = 50
	maxHeadlineLen         = 100
	maxSummaryLen          = 500
	maxOfferDescriptionLen = 10000
	maxPricingHintLen      = 200
	maxApplicationNoteLen  = 2000
	maxRequestNoteLen      = 2000
	maxReviewNoteLen       = 2000
	maxContactValueLen     = 500
)

var capabilitySlugRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$`)

func validateCapabilitySlug(slug string) error {
	if len(slug) < minCapabilitySlugLen {
		return fmt.Errorf("capability_slug must be at least %d characters", minCapabilitySlugLen)
	}
	if len(slug) > maxCapabilitySlugLen {
		return fmt.Errorf("capability_slug must be at most %d characters", maxCapabilitySlugLen)
	}
	if !capabilitySlugRegex.MatchString(slug) {
		return fmt.Errorf("capability_slug must be lowercase alphanumeric with hyphens (not starting or ending with hyphen)")
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
	CapabilitySlug  string                      `json:"capability_slug"`
	DisplayName     string                      `json:"display_name"`
	Description     string                      `json:"description"`
	ProviderEnabled bool                        `json:"provider_enabled"`
	ConsumerEnabled bool                        `json:"consumer_enabled"`
	Status          MarketplaceCapabilityStatus `json:"status"`
	PricingHint     *string                     `json:"pricing_hint,omitempty"`
}

type MarketplaceEnrollment struct {
	CapabilitySlug  string                      `json:"capability_slug"`
	Status          MarketplaceEnrollmentStatus `json:"status"`
	ApplicationNote *string                     `json:"application_note,omitempty"`
	ReviewNote      *string                     `json:"review_note,omitempty"`
	ApprovedAt      *string                     `json:"approved_at,omitempty"`
	ExpiresAt       *string                     `json:"expires_at,omitempty"`
	BillingStatus   string                      `json:"billing_status"`
	CreatedAt       string                      `json:"created_at"`
	UpdatedAt       string                      `json:"updated_at"`
}

type MarketplaceOffer struct {
	CapabilitySlug string                 `json:"capability_slug"`
	Headline       string                 `json:"headline"`
	Summary        string                 `json:"summary"`
	Description    string                 `json:"description"`
	RegionsServed  []string               `json:"regions_served"`
	PricingHint    *string                `json:"pricing_hint,omitempty"`
	ContactMode    MarketplaceContactMode `json:"contact_mode"`
	ContactValue   string                 `json:"contact_value"`
	Status         MarketplaceOfferStatus `json:"status"`
	ReviewNote     *string                `json:"review_note,omitempty"`
	CreatedAt      string                 `json:"created_at"`
	UpdatedAt      string                 `json:"updated_at"`
}

type MarketplaceProviderSummary struct {
	ProviderOrgDomain string                 `json:"provider_org_domain"`
	CapabilitySlug    string                 `json:"capability_slug"`
	Headline          string                 `json:"headline"`
	Summary           string                 `json:"summary"`
	PricingHint       *string                `json:"pricing_hint,omitempty"`
	RegionsServed     []string               `json:"regions_served"`
	ContactMode       MarketplaceContactMode `json:"contact_mode"`
	ContactValue      string                 `json:"contact_value"`
}

type MarketplaceSubscription struct {
	ProviderOrgDomain      string                        `json:"provider_org_domain"`
	CapabilitySlug         string                        `json:"capability_slug"`
	RequestNote            *string                       `json:"request_note,omitempty"`
	Status                 MarketplaceSubscriptionStatus `json:"status"`
	ReviewNote             *string                       `json:"review_note,omitempty"`
	RequiresProviderReview bool                          `json:"requires_provider_review"`
	RequiresAdminReview    bool                          `json:"requires_admin_review"`
	RequiresContract       bool                          `json:"requires_contract"`
	RequiresPayment        bool                          `json:"requires_payment"`
	StartsAt               *string                       `json:"starts_at,omitempty"`
	ExpiresAt              *string                       `json:"expires_at,omitempty"`
	CreatedAt              string                        `json:"created_at"`
	UpdatedAt              string                        `json:"updated_at"`
}

type MarketplaceIncomingSubscription struct {
	ConsumerOrgDomain string                        `json:"consumer_org_domain"`
	CapabilitySlug    string                        `json:"capability_slug"`
	Status            MarketplaceSubscriptionStatus `json:"status"`
	RequestNote       *string                       `json:"request_note,omitempty"`
	ReviewNote        *string                       `json:"review_note,omitempty"`
	UpdatedAt         string                        `json:"updated_at"`
	CreatedAt         string                        `json:"created_at"`
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
	CapabilitySlug string `json:"capability_slug"`
}

func (r GetMarketplaceCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type ListProviderEnrollmentsRequest struct {
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int    `json:"limit,omitempty"`
}

func (r ListProviderEnrollmentsRequest) Validate() []common.ValidationError {
	return nil
}

type ListProviderEnrollmentsResponse struct {
	Enrollments       []MarketplaceEnrollment `json:"enrollments"`
	NextPaginationKey *string                 `json:"next_pagination_key,omitempty"`
}

type GetProviderEnrollmentRequest struct {
	CapabilitySlug string `json:"capability_slug"`
}

func (r GetProviderEnrollmentRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type ApplyProviderEnrollmentRequest struct {
	CapabilitySlug  string  `json:"capability_slug"`
	ApplicationNote *string `json:"application_note,omitempty"`
}

func (r ApplyProviderEnrollmentRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	if r.ApplicationNote != nil && len(*r.ApplicationNote) > maxApplicationNoteLen {
		errs = append(errs, common.NewValidationError("application_note",
			fmt.Errorf("application_note must be at most %d characters", maxApplicationNoteLen)))
	}
	return errs
}

type ReapplyProviderEnrollmentRequest struct {
	CapabilitySlug  string  `json:"capability_slug"`
	ApplicationNote *string `json:"application_note,omitempty"`
}

func (r ReapplyProviderEnrollmentRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	if r.ApplicationNote != nil && len(*r.ApplicationNote) > maxApplicationNoteLen {
		errs = append(errs, common.NewValidationError("application_note",
			fmt.Errorf("application_note must be at most %d characters", maxApplicationNoteLen)))
	}
	return errs
}

type GetProviderOfferRequest struct {
	CapabilitySlug string `json:"capability_slug"`
}

func (r GetProviderOfferRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

func validateOfferFields(capSlug, headline, summary, description string, regionsServed []string, pricingHint *string, contactMode MarketplaceContactMode, contactValue string) []common.ValidationError {
	var errs []common.ValidationError
	if err := validateCapabilitySlug(capSlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
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
	} else if len(description) > maxOfferDescriptionLen {
		errs = append(errs, common.NewValidationError("description",
			fmt.Errorf("description must be at most %d characters", maxOfferDescriptionLen)))
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

type CreateProviderOfferRequest struct {
	CapabilitySlug string                 `json:"capability_slug"`
	Headline       string                 `json:"headline"`
	Summary        string                 `json:"summary"`
	Description    string                 `json:"description"`
	RegionsServed  []string               `json:"regions_served"`
	PricingHint    *string                `json:"pricing_hint,omitempty"`
	ContactMode    MarketplaceContactMode `json:"contact_mode"`
	ContactValue   string                 `json:"contact_value"`
}

func (r CreateProviderOfferRequest) Validate() []common.ValidationError {
	return validateOfferFields(r.CapabilitySlug, r.Headline, r.Summary, r.Description,
		r.RegionsServed, r.PricingHint, r.ContactMode, r.ContactValue)
}

type UpdateProviderOfferRequest struct {
	CapabilitySlug string                 `json:"capability_slug"`
	Headline       string                 `json:"headline"`
	Summary        string                 `json:"summary"`
	Description    string                 `json:"description"`
	RegionsServed  []string               `json:"regions_served"`
	PricingHint    *string                `json:"pricing_hint,omitempty"`
	ContactMode    MarketplaceContactMode `json:"contact_mode"`
	ContactValue   string                 `json:"contact_value"`
}

func (r UpdateProviderOfferRequest) Validate() []common.ValidationError {
	return validateOfferFields(r.CapabilitySlug, r.Headline, r.Summary, r.Description,
		r.RegionsServed, r.PricingHint, r.ContactMode, r.ContactValue)
}

type SubmitProviderOfferRequest struct {
	CapabilitySlug string `json:"capability_slug"`
}

func (r SubmitProviderOfferRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type ArchiveProviderOfferRequest struct {
	CapabilitySlug string `json:"capability_slug"`
}

func (r ArchiveProviderOfferRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type ListMarketplaceProvidersRequest struct {
	CapabilitySlug string  `json:"capability_slug"`
	PaginationKey  *string `json:"pagination_key,omitempty"`
	Limit          *int    `json:"limit,omitempty"`
}

func (r ListMarketplaceProvidersRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type ListMarketplaceProvidersResponse struct {
	Providers         []MarketplaceProviderSummary `json:"providers"`
	NextPaginationKey *string                      `json:"next_pagination_key,omitempty"`
}

type GetMarketplaceProviderOfferRequest struct {
	ProviderOrgDomain string `json:"provider_org_domain"`
	CapabilitySlug    string `json:"capability_slug"`
}

func (r GetMarketplaceProviderOfferRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ProviderOrgDomain == "" {
		errs = append(errs, common.NewValidationError("provider_org_domain",
			fmt.Errorf("provider_org_domain is required")))
	}
	if err := validateCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type ListConsumerSubscriptionsRequest struct {
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int    `json:"limit,omitempty"`
}

func (r ListConsumerSubscriptionsRequest) Validate() []common.ValidationError {
	return nil
}

type ListConsumerSubscriptionsResponse struct {
	Subscriptions     []MarketplaceSubscription `json:"subscriptions"`
	NextPaginationKey *string                   `json:"next_pagination_key,omitempty"`
}

type GetConsumerSubscriptionRequest struct {
	ProviderOrgDomain string `json:"provider_org_domain"`
	CapabilitySlug    string `json:"capability_slug"`
}

func (r GetConsumerSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ProviderOrgDomain == "" {
		errs = append(errs, common.NewValidationError("provider_org_domain",
			fmt.Errorf("provider_org_domain is required")))
	}
	if err := validateCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type RequestConsumerSubscriptionRequest struct {
	ProviderOrgDomain string  `json:"provider_org_domain"`
	CapabilitySlug    string  `json:"capability_slug"`
	RequestNote       *string `json:"request_note,omitempty"`
}

func (r RequestConsumerSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ProviderOrgDomain == "" {
		errs = append(errs, common.NewValidationError("provider_org_domain",
			fmt.Errorf("provider_org_domain is required")))
	}
	if err := validateCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	if r.RequestNote != nil && len(*r.RequestNote) > maxRequestNoteLen {
		errs = append(errs, common.NewValidationError("request_note",
			fmt.Errorf("request_note must be at most %d characters", maxRequestNoteLen)))
	}
	return errs
}

type CancelConsumerSubscriptionRequest struct {
	ProviderOrgDomain string `json:"provider_org_domain"`
	CapabilitySlug    string `json:"capability_slug"`
}

func (r CancelConsumerSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ProviderOrgDomain == "" {
		errs = append(errs, common.NewValidationError("provider_org_domain",
			fmt.Errorf("provider_org_domain is required")))
	}
	if err := validateCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type ListIncomingSubscriptionsRequest struct {
	CapabilitySlug *string `json:"capability_slug,omitempty"`
	PaginationKey  *string `json:"pagination_key,omitempty"`
	Limit          *int    `json:"limit,omitempty"`
}

func (r ListIncomingSubscriptionsRequest) Validate() []common.ValidationError {
	return nil
}

type ListIncomingSubscriptionsResponse struct {
	Subscriptions     []MarketplaceIncomingSubscription `json:"subscriptions"`
	NextPaginationKey *string                           `json:"next_pagination_key,omitempty"`
}

type GetIncomingSubscriptionRequest struct {
	ConsumerOrgDomain string `json:"consumer_org_domain"`
	CapabilitySlug    string `json:"capability_slug"`
}

func (r GetIncomingSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ConsumerOrgDomain == "" {
		errs = append(errs, common.NewValidationError("consumer_org_domain",
			fmt.Errorf("consumer_org_domain is required")))
	}
	if err := validateCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type ProviderApproveSubscriptionRequest struct {
	ConsumerOrgDomain string `json:"consumer_org_domain"`
	CapabilitySlug    string `json:"capability_slug"`
}

func (r ProviderApproveSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ConsumerOrgDomain == "" {
		errs = append(errs, common.NewValidationError("consumer_org_domain",
			fmt.Errorf("consumer_org_domain is required")))
	}
	if err := validateCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type ProviderRejectSubscriptionRequest struct {
	ConsumerOrgDomain string `json:"consumer_org_domain"`
	CapabilitySlug    string `json:"capability_slug"`
	ReviewNote        string `json:"review_note"`
}

func (r ProviderRejectSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ConsumerOrgDomain == "" {
		errs = append(errs, common.NewValidationError("consumer_org_domain",
			fmt.Errorf("consumer_org_domain is required")))
	}
	if err := validateCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	if r.ReviewNote == "" {
		errs = append(errs, common.NewValidationError("review_note", fmt.Errorf("review_note is required")))
	} else if len(r.ReviewNote) > maxReviewNoteLen {
		errs = append(errs, common.NewValidationError("review_note",
			fmt.Errorf("review_note must be at most %d characters", maxReviewNoteLen)))
	}
	return errs
}
