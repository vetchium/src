package org

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	orgtypes "vetchium-api-server.typespec/org"
)

// dbListingToAPI converts a regionaldb MarketplaceListing to the org API type.
func dbListingToAPI(l regionaldb.MarketplaceListing) orgtypes.MarketplaceListing {
	result := orgtypes.MarketplaceListing{
		ListingID:     uuidToString(l.ListingID),
		OrgDomain:     l.OrgDomain,
		CapabilityID:  l.CapabilityID,
		Headline:      l.Headline,
		Summary:       l.Summary,
		Description:   l.Description,
		RegionsServed: l.RegionsServed,
		ContactMode:   orgtypes.MarketplaceContactMode(l.ContactMode),
		ContactValue:  l.ContactValue,
		Status:        orgtypes.MarketplaceListingStatus(l.Status),
		CreatedAt:     l.CreatedAt.Time.UTC().Format(time.RFC3339),
		UpdatedAt:     l.UpdatedAt.Time.UTC().Format(time.RFC3339),
	}
	if l.PricingHint.Valid {
		result.PricingHint = &l.PricingHint.String
	}
	if l.SuspensionNote.Valid {
		result.SuspensionNote = &l.SuspensionNote.String
	}
	if l.ListedAt.Valid {
		s := l.ListedAt.Time.UTC().Format(time.RFC3339)
		result.ListedAt = &s
	}
	return result
}

// dbCatalogToCard converts a globaldb MarketplaceListingCatalog to the listing card API type.
func dbCatalogToCard(c globaldb.MarketplaceListingCatalog) orgtypes.MarketplaceListingCard {
	result := orgtypes.MarketplaceListingCard{
		ListingID:     uuidToString(c.ListingID),
		OrgDomain:     c.OrgDomain,
		CapabilityID:  c.CapabilityID,
		Headline:      c.Headline,
		Summary:       c.Summary,
		RegionsServed: c.RegionsServed,
		ContactMode:   orgtypes.MarketplaceContactMode(c.ContactMode),
		ContactValue:  c.ContactValue,
		ListedAt:      c.ListedAt.Time.UTC().Format(time.RFC3339),
	}
	if c.PricingHint.Valid {
		result.PricingHint = &c.PricingHint.String
	}
	return result
}

// dbSubscriptionToAPI converts a regionaldb MarketplaceSubscription to the consumer API type.
func dbSubscriptionToAPI(sub regionaldb.MarketplaceSubscription) orgtypes.MarketplaceSubscription {
	result := orgtypes.MarketplaceSubscription{
		SubscriptionID:    uuidToString(sub.SubscriptionID),
		ListingID:         uuidToString(sub.ListingID),
		ConsumerOrgDomain: sub.ConsumerOrgDomain,
		ProviderOrgDomain: sub.ProviderOrgDomain,
		CapabilityID:      sub.CapabilityID,
		Status:            orgtypes.MarketplaceSubscriptionStatus(sub.Status),
		StartedAt:         sub.StartedAt.Time.UTC().Format(time.RFC3339),
		CreatedAt:         sub.CreatedAt.Time.UTC().Format(time.RFC3339),
		UpdatedAt:         sub.UpdatedAt.Time.UTC().Format(time.RFC3339),
	}
	if sub.RequestNote.Valid {
		result.RequestNote = &sub.RequestNote.String
	}
	if sub.ExpiresAt.Valid {
		s := sub.ExpiresAt.Time.UTC().Format(time.RFC3339)
		result.ExpiresAt = &s
	}
	if sub.CancelledAt.Valid {
		s := sub.CancelledAt.Time.UTC().Format(time.RFC3339)
		result.CancelledAt = &s
	}
	return result
}

// dbSubscriptionToClient converts a regionaldb MarketplaceSubscription to the provider client API type.
func dbSubscriptionToClient(sub regionaldb.MarketplaceSubscription) orgtypes.MarketplaceClient {
	result := orgtypes.MarketplaceClient{
		SubscriptionID:    uuidToString(sub.SubscriptionID),
		ListingID:         uuidToString(sub.ListingID),
		ConsumerOrgDomain: sub.ConsumerOrgDomain,
		CapabilityID:      sub.CapabilityID,
		Status:            orgtypes.MarketplaceSubscriptionStatus(sub.Status),
		StartedAt:         sub.StartedAt.Time.UTC().Format(time.RFC3339),
		CreatedAt:         sub.CreatedAt.Time.UTC().Format(time.RFC3339),
	}
	if sub.RequestNote.Valid {
		result.RequestNote = &sub.RequestNote.String
	}
	if sub.ExpiresAt.Valid {
		s := sub.ExpiresAt.Time.UTC().Format(time.RFC3339)
		result.ExpiresAt = &s
	}
	return result
}

// parseListingUUID parses a UUID string to pgtype.UUID.
func parseListingUUID(s string) pgtype.UUID {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return pgtype.UUID{}
	}
	return u
}

// optionalListingText converts a *string to pgtype.Text.
func optionalListingText(s *string) pgtype.Text {
	if s != nil {
		return pgtype.Text{String: *s, Valid: true}
	}
	return pgtype.Text{}
}

// getOrgPrimaryDomain returns the first domain for an org from the global DB.
// Returns empty string if none found.
func getOrgPrimaryDomain(domains []globaldb.GlobalOrgDomain) string {
	if len(domains) == 0 {
		return ""
	}
	return domains[0].Domain
}
