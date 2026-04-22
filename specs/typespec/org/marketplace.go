package org

import (
	"errors"

	"vetchium-api-server.typespec/common"
)

// --- Status types ---

type MarketplaceListingStatus string

const (
	MarketplaceListingStatusDraft         MarketplaceListingStatus = "draft"
	MarketplaceListingStatusPendingReview MarketplaceListingStatus = "pending_review"
	MarketplaceListingStatusActive        MarketplaceListingStatus = "active"
	MarketplaceListingStatusSuspended     MarketplaceListingStatus = "suspended"
	MarketplaceListingStatusArchived      MarketplaceListingStatus = "archived"
)

type MarketplaceSubscriptionStatus string

const (
	MarketplaceSubscriptionStatusActive    MarketplaceSubscriptionStatus = "active"
	MarketplaceSubscriptionStatusCancelled MarketplaceSubscriptionStatus = "cancelled"
	MarketplaceSubscriptionStatusExpired   MarketplaceSubscriptionStatus = "expired"
)

type CapabilityStatus string

const (
	CapabilityStatusDraft    CapabilityStatus = "draft"
	CapabilityStatusActive   CapabilityStatus = "active"
	CapabilityStatusDisabled CapabilityStatus = "disabled"
)

// --- Sentinel errors ---

var (
	errHeadlineRequired    = errors.New("headline is required")
	errHeadlineTooLong     = errors.New("must be at most 100 characters")
	errDescRequired        = errors.New("description is required")
	errDescTooLong         = errors.New("must be at most 10000 characters")
	errCapRequired         = errors.New("at least one capability is required")
	errCapTooMany          = errors.New("at most 5 capabilities allowed")
	errCapIDRequired       = errors.New("capability_id is required")
	errListingNumRequired  = errors.New("listing_number is required")
	errOrgDomainRequired   = errors.New("org_domain is required")
	errSubIDRequired       = errors.New("subscription_id is required")
	errProviderDomainReq   = errors.New("provider_org_domain is required")
	errProviderNumRequired = errors.New("provider_listing_number is required")
	errRequestNoteTooLong  = errors.New("must be at most 2000 characters")
	errSuspNoteRequired    = errors.New("suspension_note is required")
	errSuspNoteTooLong     = errors.New("must be at most 2000 characters")
	errRejNoteRequired     = errors.New("rejection_note is required")
	errRejNoteTooLong      = errors.New("must be at most 2000 characters")
	errDisplayNameRequired = errors.New("display_name is required")
	errCapIDShort          = errors.New("must be 3-50 characters")
	errInvalidStatus       = errors.New("must be a valid status")
	errLimitRange          = errors.New("must be between 1 and 100")
)

// --- Models ---

type MarketplaceCapability struct {
	CapabilityID string           `json:"capability_id"`
	DisplayName  string           `json:"display_name"`
	Description  string           `json:"description"`
	Status       CapabilityStatus `json:"status"`
}

type ListCapabilitiesResponse struct {
	Capabilities []MarketplaceCapability `json:"capabilities"`
}

type MarketplaceListing struct {
	ListingID             string                   `json:"listing_id"`
	OrgDomain             string                   `json:"org_domain"`
	ListingNumber         int32                    `json:"listing_number"`
	Headline              string                   `json:"headline"`
	Description           string                   `json:"description"`
	Capabilities          []string                 `json:"capabilities"`
	Status                MarketplaceListingStatus `json:"status"`
	SuspensionNote        *string                  `json:"suspension_note,omitempty"`
	RejectionNote         *string                  `json:"rejection_note,omitempty"`
	ListedAt              *string                  `json:"listed_at,omitempty"`
	ActiveSubscriberCount int32                    `json:"active_subscriber_count"`
	CreatedAt             string                   `json:"created_at"`
	UpdatedAt             string                   `json:"updated_at"`
	IsSubscribed          bool                     `json:"is_subscribed"`
}

type CreateListingRequest struct {
	Headline     string   `json:"headline"`
	Description  string   `json:"description"`
	Capabilities []string `json:"capabilities"`
}

func (r CreateListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Headline == "" {
		errs = append(errs, common.NewValidationError("headline", errHeadlineRequired))
	} else if len(r.Headline) > 100 {
		errs = append(errs, common.NewValidationError("headline", errHeadlineTooLong))
	}
	if r.Description == "" {
		errs = append(errs, common.NewValidationError("description", errDescRequired))
	} else if len(r.Description) > 10000 {
		errs = append(errs, common.NewValidationError("description", errDescTooLong))
	}
	if len(r.Capabilities) == 0 {
		errs = append(errs, common.NewValidationError("capabilities", errCapRequired))
	} else if len(r.Capabilities) > 5 {
		errs = append(errs, common.NewValidationError("capabilities", errCapTooMany))
	}
	return errs
}

type UpdateListingRequest struct {
	ListingNumber int32  `json:"listing_number"`
	Headline      string `json:"headline"`
	Description   string `json:"description"`
}

func (r UpdateListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ListingNumber < 1 {
		errs = append(errs, common.NewValidationError("listing_number", errListingNumRequired))
	}
	if r.Headline == "" {
		errs = append(errs, common.NewValidationError("headline", errHeadlineRequired))
	} else if len(r.Headline) > 100 {
		errs = append(errs, common.NewValidationError("headline", errHeadlineTooLong))
	}
	if r.Description == "" {
		errs = append(errs, common.NewValidationError("description", errDescRequired))
	} else if len(r.Description) > 10000 {
		errs = append(errs, common.NewValidationError("description", errDescTooLong))
	}
	return errs
}

type GetListingRequest struct {
	OrgDomain     string `json:"org_domain"`
	ListingNumber int32  `json:"listing_number"`
}

func (r GetListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgDomain == "" {
		errs = append(errs, common.NewValidationError("org_domain", errOrgDomainRequired))
	}
	if r.ListingNumber < 1 {
		errs = append(errs, common.NewValidationError("listing_number", errListingNumRequired))
	}
	return errs
}

type ListMyListingsRequest struct {
	FilterStatus  *MarketplaceListingStatus `json:"filter_status,omitempty"`
	PaginationKey *string                   `json:"pagination_key,omitempty"`
	Limit         *int32                    `json:"limit,omitempty"`
}

func (r ListMyListingsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.FilterStatus != nil {
		switch *r.FilterStatus {
		case MarketplaceListingStatusDraft, MarketplaceListingStatusPendingReview,
			MarketplaceListingStatusActive, MarketplaceListingStatusSuspended,
			MarketplaceListingStatusArchived:
		default:
			errs = append(errs, common.NewValidationError("filter_status", errInvalidStatus))
		}
	}
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.NewValidationError("limit", errLimitRange))
	}
	return errs
}

type ListMyListingsResponse struct {
	Listings          []MarketplaceListing `json:"listings"`
	NextPaginationKey *string              `json:"next_pagination_key,omitempty"`
}

type PublishListingRequest struct {
	ListingNumber int32 `json:"listing_number"`
}

func (r PublishListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ListingNumber < 1 {
		errs = append(errs, common.NewValidationError("listing_number", errListingNumRequired))
	}
	return errs
}

type ArchiveListingRequest struct {
	ListingNumber int32 `json:"listing_number"`
}

func (r ArchiveListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ListingNumber < 1 {
		errs = append(errs, common.NewValidationError("listing_number", errListingNumRequired))
	}
	return errs
}

type ReopenListingRequest struct {
	ListingNumber int32 `json:"listing_number"`
}

func (r ReopenListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ListingNumber < 1 {
		errs = append(errs, common.NewValidationError("listing_number", errListingNumRequired))
	}
	return errs
}

type AddListingCapabilityRequest struct {
	ListingNumber int32  `json:"listing_number"`
	CapabilityID  string `json:"capability_id"`
}

func (r AddListingCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ListingNumber < 1 {
		errs = append(errs, common.NewValidationError("listing_number", errListingNumRequired))
	}
	if r.CapabilityID == "" {
		errs = append(errs, common.NewValidationError("capability_id", errCapIDRequired))
	}
	return errs
}

type RemoveListingCapabilityRequest = AddListingCapabilityRequest

type DiscoverListingsRequest struct {
	CapabilityID  *string `json:"capability_id,omitempty"`
	SearchText    *string `json:"search_text,omitempty"`
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int32  `json:"limit,omitempty"`
}

func (r DiscoverListingsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.NewValidationError("limit", errLimitRange))
	}
	return errs
}

type ListingCard struct {
	ListingID     string   `json:"listing_id"`
	OrgDomain     string   `json:"org_domain"`
	ListingNumber int32    `json:"listing_number"`
	Headline      string   `json:"headline"`
	Description   string   `json:"description"`
	CapabilityIDs []string `json:"capability_ids"`
	ListedAt      string   `json:"listed_at"`
	IsSubscribed  bool     `json:"is_subscribed"`
}

type DiscoverListingsResponse struct {
	Listings          []ListingCard `json:"listings"`
	NextPaginationKey *string       `json:"next_pagination_key,omitempty"`
}

type MarketplaceSubscription struct {
	SubscriptionID        string                        `json:"subscription_id"`
	ListingID             string                        `json:"listing_id"`
	ProviderOrgDomain     string                        `json:"provider_org_domain"`
	ProviderListingNumber int32                         `json:"provider_listing_number"`
	ConsumerOrgDomain     string                        `json:"consumer_org_domain"`
	RequestNote           string                        `json:"request_note"`
	Status                MarketplaceSubscriptionStatus `json:"status"`
	StartedAt             string                        `json:"started_at"`
	ExpiresAt             *string                       `json:"expires_at,omitempty"`
	CancelledAt           *string                       `json:"cancelled_at,omitempty"`
	CreatedAt             string                        `json:"created_at"`
	UpdatedAt             string                        `json:"updated_at"`
}

type SubscribeRequest struct {
	ProviderOrgDomain     string  `json:"provider_org_domain"`
	ProviderListingNumber int32   `json:"provider_listing_number"`
	RequestNote           *string `json:"request_note,omitempty"`
}

func (r SubscribeRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ProviderOrgDomain == "" {
		errs = append(errs, common.NewValidationError("provider_org_domain", errProviderDomainReq))
	}
	if r.ProviderListingNumber < 1 {
		errs = append(errs, common.NewValidationError("provider_listing_number", errProviderNumRequired))
	}
	if r.RequestNote != nil && len(*r.RequestNote) > 2000 {
		errs = append(errs, common.NewValidationError("request_note", errRequestNoteTooLong))
	}
	return errs
}

type CancelSubscriptionRequest struct {
	SubscriptionID string `json:"subscription_id"`
}

func (r CancelSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.SubscriptionID == "" {
		errs = append(errs, common.NewValidationError("subscription_id", errSubIDRequired))
	}
	return errs
}

type GetSubscriptionRequest struct {
	ProviderOrgDomain     string `json:"provider_org_domain"`
	ProviderListingNumber int32  `json:"provider_listing_number"`
}

func (r GetSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ProviderOrgDomain == "" {
		errs = append(errs, common.NewValidationError("provider_org_domain", errProviderDomainReq))
	}
	if r.ProviderListingNumber < 1 {
		errs = append(errs, common.NewValidationError("provider_listing_number", errProviderNumRequired))
	}
	return errs
}

type ListMySubscriptionsRequest struct {
	FilterStatus  *MarketplaceSubscriptionStatus `json:"filter_status,omitempty"`
	PaginationKey *string                        `json:"pagination_key,omitempty"`
	Limit         *int32                         `json:"limit,omitempty"`
}

func (r ListMySubscriptionsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.FilterStatus != nil {
		switch *r.FilterStatus {
		case MarketplaceSubscriptionStatusActive, MarketplaceSubscriptionStatusCancelled, MarketplaceSubscriptionStatusExpired:
		default:
			errs = append(errs, common.NewValidationError("filter_status", errInvalidStatus))
		}
	}
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.NewValidationError("limit", errLimitRange))
	}
	return errs
}

type ListMySubscriptionsResponse struct {
	Subscriptions     []MarketplaceSubscription `json:"subscriptions"`
	NextPaginationKey *string                   `json:"next_pagination_key,omitempty"`
}

type MarketplaceClient struct {
	SubscriptionID    string                        `json:"subscription_id"`
	ConsumerOrgDomain string                        `json:"consumer_org_domain"`
	ListingNumber     int32                         `json:"listing_number"`
	RequestNote       string                        `json:"request_note"`
	Status            MarketplaceSubscriptionStatus `json:"status"`
	StartedAt         string                        `json:"started_at"`
}

type ListMyClientsRequest struct {
	ListingNumber *int32  `json:"listing_number,omitempty"`
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int32  `json:"limit,omitempty"`
}

func (r ListMyClientsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.NewValidationError("limit", errLimitRange))
	}
	return errs
}

type ListMyClientsResponse struct {
	Clients           []MarketplaceClient `json:"clients"`
	NextPaginationKey *string             `json:"next_pagination_key,omitempty"`
}

// --- Admin types ---

type AdminCreateCapabilityRequest struct {
	CapabilityID string  `json:"capability_id"`
	DisplayName  string  `json:"display_name"`
	Description  *string `json:"description,omitempty"`
}

func (r AdminCreateCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.CapabilityID == "" {
		errs = append(errs, common.NewValidationError("capability_id", errCapIDRequired))
	} else if len(r.CapabilityID) < 3 || len(r.CapabilityID) > 50 {
		errs = append(errs, common.NewValidationError("capability_id", errCapIDShort))
	}
	if r.DisplayName == "" {
		errs = append(errs, common.NewValidationError("display_name", errDisplayNameRequired))
	}
	return errs
}

type AdminUpdateCapabilityRequest struct {
	CapabilityID string           `json:"capability_id"`
	Status       CapabilityStatus `json:"status"`
	DisplayName  *string          `json:"display_name,omitempty"`
	Description  *string          `json:"description,omitempty"`
}

func (r AdminUpdateCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.CapabilityID == "" {
		errs = append(errs, common.NewValidationError("capability_id", errCapIDRequired))
	}
	switch r.Status {
	case CapabilityStatusDraft, CapabilityStatusActive, CapabilityStatusDisabled:
	default:
		errs = append(errs, common.NewValidationError("status", errInvalidStatus))
	}
	return errs
}

type AdminListListingsRequest struct {
	FilterOrgDomain    *string                   `json:"filter_org_domain,omitempty"`
	FilterCapabilityID *string                   `json:"filter_capability_id,omitempty"`
	FilterStatus       *MarketplaceListingStatus `json:"filter_status,omitempty"`
	PaginationKey      *string                   `json:"pagination_key,omitempty"`
	Limit              *int32                    `json:"limit,omitempty"`
}

func (r AdminListListingsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.FilterStatus != nil {
		switch *r.FilterStatus {
		case MarketplaceListingStatusDraft, MarketplaceListingStatusPendingReview,
			MarketplaceListingStatusActive, MarketplaceListingStatusSuspended,
			MarketplaceListingStatusArchived:
		default:
			errs = append(errs, common.NewValidationError("filter_status", errInvalidStatus))
		}
	}
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.NewValidationError("limit", errLimitRange))
	}
	return errs
}

type AdminListListingsResponse struct {
	Listings          []MarketplaceListing `json:"listings"`
	NextPaginationKey *string              `json:"next_pagination_key,omitempty"`
}

type AdminSuspendListingRequest struct {
	OrgDomain      string `json:"org_domain"`
	ListingNumber  int32  `json:"listing_number"`
	SuspensionNote string `json:"suspension_note"`
}

func (r AdminSuspendListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgDomain == "" {
		errs = append(errs, common.NewValidationError("org_domain", errOrgDomainRequired))
	}
	if r.ListingNumber < 1 {
		errs = append(errs, common.NewValidationError("listing_number", errListingNumRequired))
	}
	if r.SuspensionNote == "" {
		errs = append(errs, common.NewValidationError("suspension_note", errSuspNoteRequired))
	} else if len(r.SuspensionNote) > 2000 {
		errs = append(errs, common.NewValidationError("suspension_note", errSuspNoteTooLong))
	}
	return errs
}

type AdminReinstateListingRequest struct {
	OrgDomain     string `json:"org_domain"`
	ListingNumber int32  `json:"listing_number"`
}

func (r AdminReinstateListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgDomain == "" {
		errs = append(errs, common.NewValidationError("org_domain", errOrgDomainRequired))
	}
	if r.ListingNumber < 1 {
		errs = append(errs, common.NewValidationError("listing_number", errListingNumRequired))
	}
	return errs
}

type AdminApproveListingRequest = AdminReinstateListingRequest

type AdminRejectListingRequest struct {
	OrgDomain     string `json:"org_domain"`
	ListingNumber int32  `json:"listing_number"`
	RejectionNote string `json:"rejection_note"`
}

func (r AdminRejectListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OrgDomain == "" {
		errs = append(errs, common.NewValidationError("org_domain", errOrgDomainRequired))
	}
	if r.ListingNumber < 1 {
		errs = append(errs, common.NewValidationError("listing_number", errListingNumRequired))
	}
	if r.RejectionNote == "" {
		errs = append(errs, common.NewValidationError("rejection_note", errRejNoteRequired))
	} else if len(r.RejectionNote) > 2000 {
		errs = append(errs, common.NewValidationError("rejection_note", errRejNoteTooLong))
	}
	return errs
}

type AdminListSubscriptionsRequest struct {
	FilterProviderOrgDomain *string                        `json:"filter_provider_org_domain,omitempty"`
	FilterStatus            *MarketplaceSubscriptionStatus `json:"filter_status,omitempty"`
	PaginationKey           *string                        `json:"pagination_key,omitempty"`
	Limit                   *int32                         `json:"limit,omitempty"`
}

func (r AdminListSubscriptionsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.FilterStatus != nil {
		switch *r.FilterStatus {
		case MarketplaceSubscriptionStatusActive, MarketplaceSubscriptionStatusCancelled, MarketplaceSubscriptionStatusExpired:
		default:
			errs = append(errs, common.NewValidationError("filter_status", errInvalidStatus))
		}
	}
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.NewValidationError("limit", errLimitRange))
	}
	return errs
}

type AdminListSubscriptionsResponse struct {
	Subscriptions     []MarketplaceSubscription `json:"subscriptions"`
	NextPaginationKey *string                   `json:"next_pagination_key,omitempty"`
}

type AdminCancelSubscriptionRequest struct {
	SubscriptionID string `json:"subscription_id"`
}

func (r AdminCancelSubscriptionRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.SubscriptionID == "" {
		errs = append(errs, common.NewValidationError("subscription_id", errSubIDRequired))
	}
	return errs
}
