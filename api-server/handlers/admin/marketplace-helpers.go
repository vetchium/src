package admin

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	admintypes "vetchium-api-server.typespec/admin"
)

// adminCapabilityToAPI converts a globaldb MarketplaceCapability to the admin API type.
func adminCapabilityToAPI(c globaldb.MarketplaceCapability) admintypes.AdminMarketplaceCapability {
	result := admintypes.AdminMarketplaceCapability{
		CapabilitySlug:       c.CapabilitySlug,
		DisplayName:          c.DisplayName,
		Description:          c.Description,
		ProviderEnabled:      c.ProviderEnabled,
		ConsumerEnabled:      c.ConsumerEnabled,
		EnrollmentApproval:   c.EnrollmentApproval,
		OfferReview:          c.OfferReview,
		SubscriptionApproval: c.SubscriptionApproval,
		ContractRequired:     c.ContractRequired,
		PaymentRequired:      c.PaymentRequired,
		Status:               c.Status,
		CreatedAt:            c.CreatedAt.Time.UTC().Format(time.RFC3339),
		UpdatedAt:            c.UpdatedAt.Time.UTC().Format(time.RFC3339),
	}
	if c.PricingHint.Valid {
		result.PricingHint = &c.PricingHint.String
	}
	return result
}

// adminEnrollmentToAPI converts a regionaldb MarketplaceEnrollment to the admin API type.
func adminEnrollmentToAPI(orgDomain string, e regionaldb.MarketplaceEnrollment) admintypes.AdminMarketplaceEnrollment {
	result := admintypes.AdminMarketplaceEnrollment{
		OrgDomain:      orgDomain,
		CapabilitySlug: e.CapabilitySlug,
		Status:         string(e.Status),
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
	if e.BillingReference.Valid {
		result.BillingReference = &e.BillingReference.String
	}
	return result
}

// adminOfferToAPI converts a regionaldb MarketplaceOffer to the admin API type.
func adminOfferToAPI(orgDomain string, o regionaldb.MarketplaceOffer) admintypes.AdminMarketplaceOffer {
	result := admintypes.AdminMarketplaceOffer{
		OrgDomain:      orgDomain,
		CapabilitySlug: o.CapabilitySlug,
		Headline:       o.Headline,
		Summary:        o.Summary,
		Description:    o.Description,
		RegionsServed:  o.RegionsServed,
		ContactMode:    o.ContactMode,
		ContactValue:   o.ContactValue,
		Status:         string(o.Status),
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

// adminSubscriptionToAPI converts a regionaldb MarketplaceSubscription to the admin API type.
func adminSubscriptionToAPI(s regionaldb.MarketplaceSubscription) admintypes.AdminMarketplaceSubscription {
	result := admintypes.AdminMarketplaceSubscription{
		ConsumerOrgDomain:      s.ConsumerOrgDomain,
		ProviderOrgDomain:      s.ProviderOrgDomain,
		CapabilitySlug:         s.CapabilitySlug,
		Status:                 string(s.Status),
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

// adminBillingRecordToAPI converts a globaldb MarketplaceBillingRecord to the admin API type.
func adminBillingRecordToAPI(b globaldb.MarketplaceBillingRecord) admintypes.AdminBillingRecord {
	result := admintypes.AdminBillingRecord{
		ConsumerOrgDomain: b.ConsumerOrgDomain,
		ProviderOrgDomain: b.ProviderOrgDomain,
		CapabilitySlug:    b.CapabilitySlug,
		EventType:         b.EventType,
		CreatedAt:         b.CreatedAt.Time.UTC().Format(time.RFC3339),
	}
	if b.Note.Valid {
		result.Note = &b.Note.String
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

// optionalTimestamptz parses an optional RFC3339 time string to pgtype.Timestamptz.
func optionalTimestamptz(s *string) pgtype.Timestamptz {
	if s != nil && *s != "" {
		t, err := time.Parse(time.RFC3339, *s)
		if err == nil {
			return pgtype.Timestamptz{Time: t, Valid: true}
		}
	}
	return pgtype.Timestamptz{}
}
