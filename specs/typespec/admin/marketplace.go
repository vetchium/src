package admin

import (
	"fmt"
	"regexp"

	"vetchium-api-server.typespec/common"
)

// ---- Admin Role constants ----

const AdminRoleViewMarketplace AdminRole = "admin:view_marketplace"
const AdminRoleManageMarketplace AdminRole = "admin:manage_marketplace"

// ---- Validation helpers ----

var adminCapabilitySlugRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$`)

const (
	adminMinCapabilitySlugLen   = 3
	adminMaxCapabilitySlugLen   = 50
	adminMaxDisplayNameLen      = 100
	adminMaxReviewNoteLen       = 2000
	adminMaxBillingReferenceLen = 200
	adminMaxPricingHintLen      = 200
	adminMaxDescriptionLen      = 5000
)

var validEnrollmentApproval = map[string]bool{
	"open":   true,
	"manual": true,
}

var validOfferReview = map[string]bool{
	"auto":   true,
	"manual": true,
}

var validSubscriptionApproval = map[string]bool{
	"direct":             true,
	"provider":           true,
	"admin":              true,
	"provider_and_admin": true,
}

func validateAdminCapabilitySlug(slug string) error {
	if len(slug) < adminMinCapabilitySlugLen {
		return fmt.Errorf("capability_slug must be at least %d characters", adminMinCapabilitySlugLen)
	}
	if len(slug) > adminMaxCapabilitySlugLen {
		return fmt.Errorf("capability_slug must be at most %d characters", adminMaxCapabilitySlugLen)
	}
	if !adminCapabilitySlugRegex.MatchString(slug) {
		return fmt.Errorf("capability_slug must be lowercase alphanumeric with hyphens (not starting or ending with hyphen)")
	}
	return nil
}

// ---- Response models ----

type AdminMarketplaceCapability struct {
	CapabilitySlug       string  `json:"capability_slug"`
	DisplayName          string  `json:"display_name"`
	Description          string  `json:"description"`
	ProviderEnabled      bool    `json:"provider_enabled"`
	ConsumerEnabled      bool    `json:"consumer_enabled"`
	EnrollmentApproval   string  `json:"enrollment_approval"`
	OfferReview          string  `json:"offer_review"`
	SubscriptionApproval string  `json:"subscription_approval"`
	ContractRequired     bool    `json:"contract_required"`
	PaymentRequired      bool    `json:"payment_required"`
	PricingHint          *string `json:"pricing_hint,omitempty"`
	Status               string  `json:"status"`
	CreatedAt            string  `json:"created_at"`
	UpdatedAt            string  `json:"updated_at"`
}

type AdminMarketplaceEnrollment struct {
	OrgDomain        string  `json:"org_domain"`
	CapabilitySlug   string  `json:"capability_slug"`
	Status           string  `json:"status"`
	ApplicationNote  *string `json:"application_note,omitempty"`
	ReviewNote       *string `json:"review_note,omitempty"`
	ApprovedAt       *string `json:"approved_at,omitempty"`
	ExpiresAt        *string `json:"expires_at,omitempty"`
	BillingReference *string `json:"billing_reference,omitempty"`
	BillingStatus    string  `json:"billing_status"`
	CreatedAt        string  `json:"created_at"`
	UpdatedAt        string  `json:"updated_at"`
}

type AdminMarketplaceOffer struct {
	OrgDomain      string   `json:"org_domain"`
	CapabilitySlug string   `json:"capability_slug"`
	Headline       string   `json:"headline"`
	Summary        string   `json:"summary"`
	Description    string   `json:"description"`
	RegionsServed  []string `json:"regions_served"`
	PricingHint    *string  `json:"pricing_hint,omitempty"`
	ContactMode    string   `json:"contact_mode"`
	ContactValue   string   `json:"contact_value"`
	Status         string   `json:"status"`
	ReviewNote     *string  `json:"review_note,omitempty"`
	CreatedAt      string   `json:"created_at"`
	UpdatedAt      string   `json:"updated_at"`
}

type AdminMarketplaceSubscription struct {
	ConsumerOrgDomain      string  `json:"consumer_org_domain"`
	ProviderOrgDomain      string  `json:"provider_org_domain"`
	CapabilitySlug         string  `json:"capability_slug"`
	RequestNote            *string `json:"request_note,omitempty"`
	Status                 string  `json:"status"`
	ReviewNote             *string `json:"review_note,omitempty"`
	RequiresProviderReview bool    `json:"requires_provider_review"`
	RequiresAdminReview    bool    `json:"requires_admin_review"`
	RequiresContract       bool    `json:"requires_contract"`
	RequiresPayment        bool    `json:"requires_payment"`
	StartsAt               *string `json:"starts_at,omitempty"`
	ExpiresAt              *string `json:"expires_at,omitempty"`
	CreatedAt              string  `json:"created_at"`
	UpdatedAt              string  `json:"updated_at"`
}

type AdminBillingRecord struct {
	ConsumerOrgDomain string  `json:"consumer_org_domain"`
	ProviderOrgDomain string  `json:"provider_org_domain"`
	CapabilitySlug    string  `json:"capability_slug"`
	EventType         string  `json:"event_type"`
	Note              *string `json:"note,omitempty"`
	CreatedAt         string  `json:"created_at"`
}

// ---- Capability Catalog request types ----

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
	CapabilitySlug string `json:"capability_slug"`
}

func (r AdminGetCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type AdminCreateCapabilityRequest struct {
	CapabilitySlug       string  `json:"capability_slug"`
	DisplayName          string  `json:"display_name"`
	Description          string  `json:"description"`
	ProviderEnabled      bool    `json:"provider_enabled"`
	ConsumerEnabled      bool    `json:"consumer_enabled"`
	EnrollmentApproval   string  `json:"enrollment_approval"`
	OfferReview          string  `json:"offer_review"`
	SubscriptionApproval string  `json:"subscription_approval"`
	ContractRequired     bool    `json:"contract_required"`
	PaymentRequired      bool    `json:"payment_required"`
	PricingHint          *string `json:"pricing_hint,omitempty"`
}

func (r AdminCreateCapabilityRequest) Validate() []common.ValidationError {
	return validateCapabilityFields(r.CapabilitySlug, r.DisplayName, r.Description,
		r.EnrollmentApproval, r.OfferReview, r.SubscriptionApproval, r.PricingHint)
}

type AdminUpdateCapabilityRequest struct {
	CapabilitySlug       string  `json:"capability_slug"`
	DisplayName          string  `json:"display_name"`
	Description          string  `json:"description"`
	ProviderEnabled      bool    `json:"provider_enabled"`
	ConsumerEnabled      bool    `json:"consumer_enabled"`
	EnrollmentApproval   string  `json:"enrollment_approval"`
	OfferReview          string  `json:"offer_review"`
	SubscriptionApproval string  `json:"subscription_approval"`
	ContractRequired     bool    `json:"contract_required"`
	PaymentRequired      bool    `json:"payment_required"`
	PricingHint          *string `json:"pricing_hint,omitempty"`
}

func (r AdminUpdateCapabilityRequest) Validate() []common.ValidationError {
	return validateCapabilityFields(r.CapabilitySlug, r.DisplayName, r.Description,
		r.EnrollmentApproval, r.OfferReview, r.SubscriptionApproval, r.PricingHint)
}

func validateCapabilityFields(slug, displayName, description, enrollmentApproval, offerReview, subscriptionApproval string, pricingHint *string) []common.ValidationError {
	var errs []common.ValidationError
	if err := validateAdminCapabilitySlug(slug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	if displayName == "" {
		errs = append(errs, common.NewValidationError("display_name", fmt.Errorf("display_name is required")))
	} else if len(displayName) > adminMaxDisplayNameLen {
		errs = append(errs, common.NewValidationError("display_name",
			fmt.Errorf("display_name must be at most %d characters", adminMaxDisplayNameLen)))
	}
	if len(description) > adminMaxDescriptionLen {
		errs = append(errs, common.NewValidationError("description",
			fmt.Errorf("description must be at most %d characters", adminMaxDescriptionLen)))
	}
	if !validEnrollmentApproval[enrollmentApproval] {
		errs = append(errs, common.NewValidationError("enrollment_approval",
			fmt.Errorf("enrollment_approval must be 'open' or 'manual'")))
	}
	if !validOfferReview[offerReview] {
		errs = append(errs, common.NewValidationError("offer_review",
			fmt.Errorf("offer_review must be 'auto' or 'manual'")))
	}
	if !validSubscriptionApproval[subscriptionApproval] {
		errs = append(errs, common.NewValidationError("subscription_approval",
			fmt.Errorf("subscription_approval must be 'direct', 'provider', 'admin', or 'provider_and_admin'")))
	}
	if pricingHint != nil && len(*pricingHint) > adminMaxPricingHintLen {
		errs = append(errs, common.NewValidationError("pricing_hint",
			fmt.Errorf("pricing_hint must be at most %d characters", adminMaxPricingHintLen)))
	}
	return errs
}

type AdminEnableCapabilityRequest struct {
	CapabilitySlug string `json:"capability_slug"`
}

func (r AdminEnableCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type AdminDisableCapabilityRequest struct {
	CapabilitySlug string `json:"capability_slug"`
}

func (r AdminDisableCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

// ---- Enrollment request types ----

type AdminListEnrollmentsRequest struct {
	FilterOrgDomain      *string `json:"filter_org_domain,omitempty"`
	FilterCapabilitySlug *string `json:"filter_capability_slug,omitempty"`
	FilterStatus         *string `json:"filter_status,omitempty"`
	PaginationKey        *string `json:"pagination_key,omitempty"`
	Limit                *int    `json:"limit,omitempty"`
}

func (r AdminListEnrollmentsRequest) Validate() []common.ValidationError {
	return nil
}

type AdminListEnrollmentsResponse struct {
	Enrollments       []AdminMarketplaceEnrollment `json:"enrollments"`
	NextPaginationKey *string                      `json:"next_pagination_key,omitempty"`
}

type AdminGetEnrollmentRequest struct {
	OrgDomain      string `json:"org_domain"`
	CapabilitySlug string `json:"capability_slug"`
}

func (r AdminGetEnrollmentRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgDomain == "" {
		errs = append(errs, common.NewValidationError("org_domain", fmt.Errorf("org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type AdminApproveEnrollmentRequest struct {
	OrgDomain        string  `json:"org_domain"`
	CapabilitySlug   string  `json:"capability_slug"`
	ExpiresAt        *string `json:"expires_at,omitempty"`
	BillingReference *string `json:"billing_reference,omitempty"`
	ReviewNote       *string `json:"review_note,omitempty"`
}

func (r AdminApproveEnrollmentRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgDomain == "" {
		errs = append(errs, common.NewValidationError("org_domain", fmt.Errorf("org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	if r.BillingReference != nil && len(*r.BillingReference) > adminMaxBillingReferenceLen {
		errs = append(errs, common.NewValidationError("billing_reference",
			fmt.Errorf("billing_reference must be at most %d characters", adminMaxBillingReferenceLen)))
	}
	return errs
}

type AdminRejectEnrollmentRequest struct {
	OrgDomain      string `json:"org_domain"`
	CapabilitySlug string `json:"capability_slug"`
	ReviewNote     string `json:"review_note"`
}

func (r AdminRejectEnrollmentRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgDomain == "" {
		errs = append(errs, common.NewValidationError("org_domain", fmt.Errorf("org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	if r.ReviewNote == "" {
		errs = append(errs, common.NewValidationError("review_note", fmt.Errorf("review_note is required")))
	}
	return errs
}

type AdminSuspendEnrollmentRequest struct {
	OrgDomain      string `json:"org_domain"`
	CapabilitySlug string `json:"capability_slug"`
	ReviewNote     string `json:"review_note"`
}

func (r AdminSuspendEnrollmentRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgDomain == "" {
		errs = append(errs, common.NewValidationError("org_domain", fmt.Errorf("org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	if r.ReviewNote == "" {
		errs = append(errs, common.NewValidationError("review_note", fmt.Errorf("review_note is required")))
	}
	return errs
}

type AdminReinstateEnrollmentRequest struct {
	OrgDomain      string `json:"org_domain"`
	CapabilitySlug string `json:"capability_slug"`
}

func (r AdminReinstateEnrollmentRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgDomain == "" {
		errs = append(errs, common.NewValidationError("org_domain", fmt.Errorf("org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type AdminRenewEnrollmentRequest struct {
	OrgDomain        string  `json:"org_domain"`
	CapabilitySlug   string  `json:"capability_slug"`
	ExpiresAt        *string `json:"expires_at,omitempty"`
	BillingReference *string `json:"billing_reference,omitempty"`
	ReviewNote       *string `json:"review_note,omitempty"`
}

func (r AdminRenewEnrollmentRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgDomain == "" {
		errs = append(errs, common.NewValidationError("org_domain", fmt.Errorf("org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	if r.BillingReference != nil && len(*r.BillingReference) > adminMaxBillingReferenceLen {
		errs = append(errs, common.NewValidationError("billing_reference",
			fmt.Errorf("billing_reference must be at most %d characters", adminMaxBillingReferenceLen)))
	}
	return errs
}

// ---- Offer request types ----

type AdminListOffersRequest struct {
	FilterOrgDomain      *string `json:"filter_org_domain,omitempty"`
	FilterCapabilitySlug *string `json:"filter_capability_slug,omitempty"`
	FilterStatus         *string `json:"filter_status,omitempty"`
	PaginationKey        *string `json:"pagination_key,omitempty"`
	Limit                *int    `json:"limit,omitempty"`
}

func (r AdminListOffersRequest) Validate() []common.ValidationError {
	return nil
}

type AdminListOffersResponse struct {
	Offers            []AdminMarketplaceOffer `json:"offers"`
	NextPaginationKey *string                 `json:"next_pagination_key,omitempty"`
}

type AdminGetOfferRequest struct {
	OrgDomain      string `json:"org_domain"`
	CapabilitySlug string `json:"capability_slug"`
}

func (r AdminGetOfferRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgDomain == "" {
		errs = append(errs, common.NewValidationError("org_domain", fmt.Errorf("org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type AdminApproveOfferRequest struct {
	OrgDomain      string  `json:"org_domain"`
	CapabilitySlug string  `json:"capability_slug"`
	ReviewNote     *string `json:"review_note,omitempty"`
}

func (r AdminApproveOfferRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgDomain == "" {
		errs = append(errs, common.NewValidationError("org_domain", fmt.Errorf("org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type AdminRejectOfferRequest struct {
	OrgDomain      string `json:"org_domain"`
	CapabilitySlug string `json:"capability_slug"`
	ReviewNote     string `json:"review_note"`
}

func (r AdminRejectOfferRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgDomain == "" {
		errs = append(errs, common.NewValidationError("org_domain", fmt.Errorf("org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	if r.ReviewNote == "" {
		errs = append(errs, common.NewValidationError("review_note", fmt.Errorf("review_note is required")))
	}
	return errs
}

type AdminSuspendOfferRequest struct {
	OrgDomain      string `json:"org_domain"`
	CapabilitySlug string `json:"capability_slug"`
	ReviewNote     string `json:"review_note"`
}

func (r AdminSuspendOfferRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgDomain == "" {
		errs = append(errs, common.NewValidationError("org_domain", fmt.Errorf("org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	if r.ReviewNote == "" {
		errs = append(errs, common.NewValidationError("review_note", fmt.Errorf("review_note is required")))
	}
	return errs
}

type AdminReinstateOfferRequest struct {
	OrgDomain      string `json:"org_domain"`
	CapabilitySlug string `json:"capability_slug"`
}

func (r AdminReinstateOfferRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgDomain == "" {
		errs = append(errs, common.NewValidationError("org_domain", fmt.Errorf("org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

// ---- Subscription request types ----

type AdminListSubscriptionsRequest struct {
	FilterConsumerOrgDomain *string `json:"filter_consumer_org_domain,omitempty"`
	FilterProviderOrgDomain *string `json:"filter_provider_org_domain,omitempty"`
	FilterCapabilitySlug    *string `json:"filter_capability_slug,omitempty"`
	FilterStatus            *string `json:"filter_status,omitempty"`
	PaginationKey           *string `json:"pagination_key,omitempty"`
	Limit                   *int    `json:"limit,omitempty"`
}

func (r AdminListSubscriptionsRequest) Validate() []common.ValidationError {
	return nil
}

type AdminListSubscriptionsResponse struct {
	Subscriptions     []AdminMarketplaceSubscription `json:"subscriptions"`
	NextPaginationKey *string                        `json:"next_pagination_key,omitempty"`
}

type AdminGetSubscriptionRequest struct {
	ConsumerOrgDomain string `json:"consumer_org_domain"`
	ProviderOrgDomain string `json:"provider_org_domain"`
	CapabilitySlug    string `json:"capability_slug"`
}

func (r AdminGetSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ConsumerOrgDomain == "" {
		errs = append(errs, common.NewValidationError("consumer_org_domain", fmt.Errorf("consumer_org_domain is required")))
	}
	if r.ProviderOrgDomain == "" {
		errs = append(errs, common.NewValidationError("provider_org_domain", fmt.Errorf("provider_org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type AdminApproveSubscriptionRequest struct {
	ConsumerOrgDomain string  `json:"consumer_org_domain"`
	ProviderOrgDomain string  `json:"provider_org_domain"`
	CapabilitySlug    string  `json:"capability_slug"`
	ReviewNote        *string `json:"review_note,omitempty"`
}

func (r AdminApproveSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ConsumerOrgDomain == "" {
		errs = append(errs, common.NewValidationError("consumer_org_domain", fmt.Errorf("consumer_org_domain is required")))
	}
	if r.ProviderOrgDomain == "" {
		errs = append(errs, common.NewValidationError("provider_org_domain", fmt.Errorf("provider_org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type AdminRejectSubscriptionRequest struct {
	ConsumerOrgDomain string `json:"consumer_org_domain"`
	ProviderOrgDomain string `json:"provider_org_domain"`
	CapabilitySlug    string `json:"capability_slug"`
	ReviewNote        string `json:"review_note"`
}

func (r AdminRejectSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ConsumerOrgDomain == "" {
		errs = append(errs, common.NewValidationError("consumer_org_domain", fmt.Errorf("consumer_org_domain is required")))
	}
	if r.ProviderOrgDomain == "" {
		errs = append(errs, common.NewValidationError("provider_org_domain", fmt.Errorf("provider_org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	if r.ReviewNote == "" {
		errs = append(errs, common.NewValidationError("review_note", fmt.Errorf("review_note is required")))
	}
	return errs
}

type AdminMarkContractSignedRequest struct {
	ConsumerOrgDomain string  `json:"consumer_org_domain"`
	ProviderOrgDomain string  `json:"provider_org_domain"`
	CapabilitySlug    string  `json:"capability_slug"`
	Note              *string `json:"note,omitempty"`
}

func (r AdminMarkContractSignedRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ConsumerOrgDomain == "" {
		errs = append(errs, common.NewValidationError("consumer_org_domain", fmt.Errorf("consumer_org_domain is required")))
	}
	if r.ProviderOrgDomain == "" {
		errs = append(errs, common.NewValidationError("provider_org_domain", fmt.Errorf("provider_org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type AdminWaiveContractRequest struct {
	ConsumerOrgDomain string `json:"consumer_org_domain"`
	ProviderOrgDomain string `json:"provider_org_domain"`
	CapabilitySlug    string `json:"capability_slug"`
	Note              string `json:"note"`
}

func (r AdminWaiveContractRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ConsumerOrgDomain == "" {
		errs = append(errs, common.NewValidationError("consumer_org_domain", fmt.Errorf("consumer_org_domain is required")))
	}
	if r.ProviderOrgDomain == "" {
		errs = append(errs, common.NewValidationError("provider_org_domain", fmt.Errorf("provider_org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	if r.Note == "" {
		errs = append(errs, common.NewValidationError("note", fmt.Errorf("note is required")))
	}
	return errs
}

type AdminRecordPaymentRequest struct {
	ConsumerOrgDomain string  `json:"consumer_org_domain"`
	ProviderOrgDomain string  `json:"provider_org_domain"`
	CapabilitySlug    string  `json:"capability_slug"`
	Note              *string `json:"note,omitempty"`
}

func (r AdminRecordPaymentRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ConsumerOrgDomain == "" {
		errs = append(errs, common.NewValidationError("consumer_org_domain", fmt.Errorf("consumer_org_domain is required")))
	}
	if r.ProviderOrgDomain == "" {
		errs = append(errs, common.NewValidationError("provider_org_domain", fmt.Errorf("provider_org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

type AdminWaivePaymentRequest struct {
	ConsumerOrgDomain string `json:"consumer_org_domain"`
	ProviderOrgDomain string `json:"provider_org_domain"`
	CapabilitySlug    string `json:"capability_slug"`
	Note              string `json:"note"`
}

func (r AdminWaivePaymentRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ConsumerOrgDomain == "" {
		errs = append(errs, common.NewValidationError("consumer_org_domain", fmt.Errorf("consumer_org_domain is required")))
	}
	if r.ProviderOrgDomain == "" {
		errs = append(errs, common.NewValidationError("provider_org_domain", fmt.Errorf("provider_org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	if r.Note == "" {
		errs = append(errs, common.NewValidationError("note", fmt.Errorf("note is required")))
	}
	return errs
}

type AdminCancelSubscriptionRequest struct {
	ConsumerOrgDomain string `json:"consumer_org_domain"`
	ProviderOrgDomain string `json:"provider_org_domain"`
	CapabilitySlug    string `json:"capability_slug"`
}

func (r AdminCancelSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ConsumerOrgDomain == "" {
		errs = append(errs, common.NewValidationError("consumer_org_domain", fmt.Errorf("consumer_org_domain is required")))
	}
	if r.ProviderOrgDomain == "" {
		errs = append(errs, common.NewValidationError("provider_org_domain", fmt.Errorf("provider_org_domain is required")))
	}
	if err := validateAdminCapabilitySlug(r.CapabilitySlug); err != nil {
		errs = append(errs, common.NewValidationError("capability_slug", err))
	}
	return errs
}

// ---- Billing request types ----

type AdminListBillingRequest struct {
	FilterConsumerOrgDomain *string `json:"filter_consumer_org_domain,omitempty"`
	FilterProviderOrgDomain *string `json:"filter_provider_org_domain,omitempty"`
	FilterCapabilitySlug    *string `json:"filter_capability_slug,omitempty"`
	PaginationKey           *string `json:"pagination_key,omitempty"`
	Limit                   *int    `json:"limit,omitempty"`
}

func (r AdminListBillingRequest) Validate() []common.ValidationError {
	return nil
}

type AdminListBillingResponse struct {
	Records           []AdminBillingRecord `json:"records"`
	NextPaginationKey *string              `json:"next_pagination_key,omitempty"`
}
