package org

import (
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	orgtypes "vetchium-api-server.typespec/org"
)

// dbEnrollmentToAPI converts a regionaldb MarketplaceEnrollment to the API type.
func dbEnrollmentToAPI(e regionaldb.MarketplaceEnrollment) orgtypes.MarketplaceEnrollment {
	result := orgtypes.MarketplaceEnrollment{
		CapabilitySlug: e.CapabilitySlug,
		Status:         orgtypes.MarketplaceEnrollmentStatus(e.Status),
		BillingStatus:  e.BillingStatus,
		CreatedAt:      e.CreatedAt.Time.UTC().Format(time.RFC3339),
		UpdatedAt:      e.UpdatedAt.Time.UTC().Format(time.RFC3339),
	}
	if e.ApplicationNote.Valid {
		result.ApplicationNote = &e.ApplicationNote.String
	}
	if e.ReviewNote.Valid {
		result.ReviewNote = &e.ReviewNote.String
	}
	if e.ApprovedAt.Valid {
		s := e.ApprovedAt.Time.UTC().Format(time.RFC3339)
		result.ApprovedAt = &s
	}
	if e.ExpiresAt.Valid {
		s := e.ExpiresAt.Time.UTC().Format(time.RFC3339)
		result.ExpiresAt = &s
	}
	return result
}

// dbOfferToAPI converts a regionaldb MarketplaceOffer to the API type.
func dbOfferToAPI(o regionaldb.MarketplaceOffer) orgtypes.MarketplaceOffer {
	result := orgtypes.MarketplaceOffer{
		CapabilitySlug: o.CapabilitySlug,
		Headline:       o.Headline,
		Summary:        o.Summary,
		Description:    o.Description,
		RegionsServed:  o.RegionsServed,
		ContactMode:    orgtypes.MarketplaceContactMode(o.ContactMode),
		ContactValue:   o.ContactValue,
		Status:         orgtypes.MarketplaceOfferStatus(o.Status),
		CreatedAt:      o.CreatedAt.Time.UTC().Format(time.RFC3339),
		UpdatedAt:      o.UpdatedAt.Time.UTC().Format(time.RFC3339),
	}
	if o.PricingHint.Valid {
		result.PricingHint = &o.PricingHint.String
	}
	if o.ReviewNote.Valid {
		result.ReviewNote = &o.ReviewNote.String
	}
	return result
}

// dbSubscriptionToAPI converts a regionaldb MarketplaceSubscription to the consumer API type.
func dbSubscriptionToAPI(s regionaldb.MarketplaceSubscription) orgtypes.MarketplaceSubscription {
	result := orgtypes.MarketplaceSubscription{
		ProviderOrgDomain:      s.ProviderOrgDomain,
		CapabilitySlug:         s.CapabilitySlug,
		Status:                 orgtypes.MarketplaceSubscriptionStatus(s.Status),
		RequiresProviderReview: s.RequiresProviderReview,
		RequiresAdminReview:    s.RequiresAdminReview,
		RequiresContract:       s.RequiresContract,
		RequiresPayment:        s.RequiresPayment,
		CreatedAt:              s.CreatedAt.Time.UTC().Format(time.RFC3339),
		UpdatedAt:              s.UpdatedAt.Time.UTC().Format(time.RFC3339),
	}
	if s.RequestNote.Valid {
		result.RequestNote = &s.RequestNote.String
	}
	if s.ReviewNote.Valid {
		result.ReviewNote = &s.ReviewNote.String
	}
	if s.StartsAt.Valid {
		ts := s.StartsAt.Time.UTC().Format(time.RFC3339)
		result.StartsAt = &ts
	}
	if s.ExpiresAt.Valid {
		ts := s.ExpiresAt.Time.UTC().Format(time.RFC3339)
		result.ExpiresAt = &ts
	}
	return result
}

// dbSubscriptionToIncomingAPI converts a regionaldb MarketplaceSubscription to the incoming/provider API type.
func dbSubscriptionToIncomingAPI(s regionaldb.MarketplaceSubscription) orgtypes.MarketplaceIncomingSubscription {
	result := orgtypes.MarketplaceIncomingSubscription{
		ConsumerOrgDomain: s.ConsumerOrgDomain,
		CapabilitySlug:    s.CapabilitySlug,
		Status:            orgtypes.MarketplaceSubscriptionStatus(s.Status),
		UpdatedAt:         s.UpdatedAt.Time.UTC().Format(time.RFC3339),
		CreatedAt:         s.CreatedAt.Time.UTC().Format(time.RFC3339),
	}
	if s.RequestNote.Valid {
		result.RequestNote = &s.RequestNote.String
	}
	if s.ReviewNote.Valid {
		result.ReviewNote = &s.ReviewNote.String
	}
	return result
}

// dbCapabilityToAPI converts a globaldb MarketplaceCapability to the org-facing API type.
func dbCapabilityToAPI(c globaldb.MarketplaceCapability) orgtypes.MarketplaceCapability {
	result := orgtypes.MarketplaceCapability{
		CapabilitySlug:  c.CapabilitySlug,
		DisplayName:     c.DisplayName,
		Description:     c.Description,
		ProviderEnabled: c.ProviderEnabled,
		ConsumerEnabled: c.ConsumerEnabled,
		Status:          orgtypes.MarketplaceCapabilityStatus(c.Status),
	}
	if c.PricingHint.Valid {
		result.PricingHint = &c.PricingHint.String
	}
	return result
}

// dbCatalogEntryToProviderSummary converts a globaldb MarketplaceOfferCatalog to the provider summary.
func dbCatalogEntryToProviderSummary(c globaldb.MarketplaceOfferCatalog) orgtypes.MarketplaceProviderSummary {
	result := orgtypes.MarketplaceProviderSummary{
		ProviderOrgDomain: c.ProviderOrgDomain,
		CapabilitySlug:    c.CapabilitySlug,
		Headline:          c.Headline,
		Summary:           c.Summary,
		RegionsServed:     c.RegionsServed,
		ContactMode:       orgtypes.MarketplaceContactMode(c.ContactMode),
		ContactValue:      c.ContactValue,
	}
	if c.PricingHint.Valid {
		result.PricingHint = &c.PricingHint.String
	}
	return result
}

// encodeEnrollmentPaginationKey encodes updatedAt + capability_slug as a cursor.
func encodeEnrollmentPaginationKey(updatedAt time.Time, capabilitySlug string) string {
	return fmt.Sprintf("%s|%s", updatedAt.UTC().Format(time.RFC3339Nano), capabilitySlug)
}

// encodeSubscriptionPaginationKey encodes updatedAt + providerDomain + capabilitySlug as a cursor.
func encodeSubscriptionPaginationKey(updatedAt time.Time, providerDomain, capabilitySlug string) string {
	return fmt.Sprintf("%s|%s|%s", updatedAt.UTC().Format(time.RFC3339Nano), providerDomain, capabilitySlug)
}

// encodeIncomingSubscriptionPaginationKey encodes updatedAt + consumerDomain + capabilitySlug as a cursor.
func encodeIncomingSubscriptionPaginationKey(updatedAt time.Time, consumerDomain, capabilitySlug string) string {
	return fmt.Sprintf("%s|%s|%s", updatedAt.UTC().Format(time.RFC3339Nano), consumerDomain, capabilitySlug)
}

// uuidFromPgtype converts pgtype.UUID to a UUID string.
func uuidToPgtypeUUID(id pgtype.UUID) pgtype.UUID {
	return id
}

// globalOfferCatalogParams builds the UpsertMarketplaceOfferCatalogParams from a regional offer.
func globalOfferCatalogParams(
	globalOrgID pgtype.UUID,
	providerOrgDomain string,
	offer regionaldb.MarketplaceOffer,
	pricingHint pgtype.Text,
	region string,
) globaldb.UpsertMarketplaceOfferCatalogParams {
	return globaldb.UpsertMarketplaceOfferCatalogParams{
		ProviderOrgGlobalID: globalOrgID,
		ProviderOrgDomain:   providerOrgDomain,
		ProviderRegion:      region,
		CapabilitySlug:      offer.CapabilitySlug,
		Headline:            offer.Headline,
		Summary:             offer.Summary,
		PricingHint:         pricingHint,
		RegionsServed:       offer.RegionsServed,
		ContactMode:         offer.ContactMode,
		ContactValue:        offer.ContactValue,
		Status:              string(offer.Status),
	}
}
