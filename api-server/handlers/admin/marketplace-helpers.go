package admin

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	admintypes "vetchium-api-server.typespec/admin"
	org "vetchium-api-server.typespec/org"
)

// adminCapabilityToAPI converts a globaldb MarketplaceCapability + translations to the admin API type.
func adminCapabilityToAPI(c globaldb.MarketplaceCapability, translations []globaldb.MarketplaceCapabilityTranslation) admintypes.AdminMarketplaceCapability {
	ts := make([]admintypes.AdminCapabilityTranslation, 0, len(translations))
	for _, t := range translations {
		ts = append(ts, admintypes.AdminCapabilityTranslation{
			Locale:      t.Locale,
			DisplayName: t.DisplayName,
			Description: t.Description,
		})
	}
	return admintypes.AdminMarketplaceCapability{
		CapabilityID: c.CapabilityID,
		Status:       org.MarketplaceCapabilityStatus(c.Status),
		Translations: ts,
		CreatedAt:    c.CreatedAt.Time.UTC().Format(time.RFC3339),
		UpdatedAt:    c.UpdatedAt.Time.UTC().Format(time.RFC3339),
	}
}

// adminListingToAPI converts a regionaldb MarketplaceListing to the admin API type.
func adminListingToAPI(l regionaldb.MarketplaceListing) admintypes.AdminMarketplaceListing {
	result := admintypes.AdminMarketplaceListing{
		ListingID:     uuidToString(l.ListingID),
		OrgDomain:     l.OrgDomain,
		CapabilityID:  l.CapabilityID,
		Headline:      l.Headline,
		Summary:       l.Summary,
		Description:   l.Description,
		RegionsServed: l.RegionsServed,
		ContactMode:   org.MarketplaceContactMode(l.ContactMode),
		ContactValue:  l.ContactValue,
		Status:        org.MarketplaceListingStatus(l.Status),
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

// adminSubscriptionToAPI converts a regionaldb MarketplaceSubscription to the admin API type.
func adminSubscriptionToAPI(sub regionaldb.MarketplaceSubscription) admintypes.AdminMarketplaceSubscription {
	result := admintypes.AdminMarketplaceSubscription{
		SubscriptionID:    uuidToString(sub.SubscriptionID),
		ListingID:         uuidToString(sub.ListingID),
		ConsumerOrgDomain: sub.ConsumerOrgDomain,
		ProviderOrgDomain: sub.ProviderOrgDomain,
		CapabilityID:      sub.CapabilityID,
		Status:            org.MarketplaceSubscriptionStatus(sub.Status),
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

// optionalText converts a *string to pgtype.Text.
func optionalText(s *string) pgtype.Text {
	if s != nil {
		return pgtype.Text{String: *s, Valid: true}
	}
	return pgtype.Text{}
}

// parseUUID parses a UUID string to pgtype.UUID. Returns invalid UUID on error.
func parseUUID(s string) pgtype.UUID {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return pgtype.UUID{}
	}
	return u
}
