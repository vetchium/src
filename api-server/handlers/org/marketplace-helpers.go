package org

import (
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	orgtypes "vetchium-api-server.typespec/org"
)

// dbOrgCapabilityToAPI converts a DB OrgCapability to the API type.
func dbOrgCapabilityToAPI(cap regionaldb.OrgCapability) orgtypes.OrgCapability {
	result := orgtypes.OrgCapability{
		Capability: cap.Capability,
		Status:     orgtypes.OrgCapabilityStatus(cap.Status),
		CreatedAt:  cap.CreatedAt.Time.UTC().Format(time.RFC3339),
	}

	if cap.ApplicationNote.Valid {
		result.ApplicationNote = &cap.ApplicationNote.String
	}
	if cap.AppliedAt.Valid {
		s := cap.AppliedAt.Time.UTC().Format(time.RFC3339)
		result.AppliedAt = &s
	}
	if cap.AdminNote.Valid {
		result.AdminNote = &cap.AdminNote.String
	}
	if cap.GrantedAt.Valid {
		s := cap.GrantedAt.Time.UTC().Format(time.RFC3339)
		result.GrantedAt = &s
	}
	if cap.ExpiresAt.Valid {
		s := cap.ExpiresAt.Time.UTC().Format(time.RFC3339)
		result.ExpiresAt = &s
	}
	// SubscriptionPrice and Currency: only set if valid
	if cap.SubscriptionPrice.Valid {
		s := cap.SubscriptionPrice.Int.String()
		if cap.SubscriptionPrice.Exp != 0 {
			s = fmt.Sprintf("%se%d", s, cap.SubscriptionPrice.Exp)
		}
		result.SubscriptionPrice = &s
	}
	if cap.Currency.Valid {
		result.Currency = &cap.Currency.String
	}

	return result
}

// dbServiceListingToAPI converts a DB MarketplaceServiceListing to the full API ServiceListing type.
// orgDomain is the primary domain of the owning org (looked up from global DB by the caller).
func dbServiceListingToAPI(sl regionaldb.MarketplaceServiceListing, orgDomain string) orgtypes.ServiceListing {
	result := orgtypes.ServiceListing{
		OrgDomain:                 orgDomain,
		Name:                      sl.Name,
		ShortBlurb:                sl.ShortBlurb,
		Description:               sl.Description,
		ServiceCategory:           orgtypes.ServiceCategory(sl.ServiceCategory),
		CountriesOfService:        sl.CountriesOfService,
		ContactURL:                sl.ContactUrl,
		State:                     orgtypes.ServiceListingState(sl.State),
		AppealExhausted:           sl.AppealExhausted,
		IndustriesServed:          sl.IndustriesServed,
		CompanySizesServed:        sl.CompanySizesServed,
		JobFunctionsSourced:       sl.JobFunctionsSourced,
		SeniorityLevelsSourced:    sl.SeniorityLevelsSourced,
		GeographicSourcingRegions: sl.GeographicSourcingRegions,
		CreatedAt:                 sl.CreatedAt.Time.UTC().Format(time.RFC3339),
		UpdatedAt:                 sl.UpdatedAt.Time.UTC().Format(time.RFC3339),
	}

	if sl.PricingInfo.Valid {
		result.PricingInfo = &sl.PricingInfo.String
	}
	if sl.LastActivatedAt.Valid {
		s := sl.LastActivatedAt.Time.UTC().Format(time.RFC3339)
		result.LastActivatedAt = &s
	}
	if sl.IndustriesServedOther.Valid {
		result.IndustriesServedOther = &sl.IndustriesServedOther.String
	}
	if sl.LastReviewAdminNote.Valid {
		result.LastReviewAdminNote = &sl.LastReviewAdminNote.String
	}
	if sl.AppealReason.Valid {
		result.AppealReason = &sl.AppealReason.String
	}
	if sl.AppealAdminNote.Valid {
		result.AppealAdminNote = &sl.AppealAdminNote.String
	}

	return result
}

// dbBrowseRowToSummary converts a BrowseActiveServiceListingsRow to ServiceListingSummary.
// orgDomain is the primary domain of the owning org (looked up from global DB by the caller).
func dbBrowseRowToSummary(row regionaldb.BrowseActiveServiceListingsRow, orgDomain string) orgtypes.ServiceListingSummary {
	return orgtypes.ServiceListingSummary{
		OrgDomain:          orgDomain,
		Name:               row.Name,
		ShortBlurb:         row.ShortBlurb,
		OrgName:            "", // populated by caller if needed
		ServiceCategory:    orgtypes.ServiceCategory(row.ServiceCategory),
		CountriesOfService: row.CountriesOfService,
		CreatedAt:          row.CreatedAt.Time.UTC().Format(time.RFC3339),
	}
}

// encodeServiceListingCursor encodes (createdAt, id) into a base64 cursor string.
func encodeServiceListingCursor(createdAt time.Time, id pgtype.UUID) string {
	idStr := uuidToString(id)
	data := fmt.Sprintf("%s|%s", createdAt.UTC().Format(time.RFC3339Nano), idStr)
	return base64.URLEncoding.EncodeToString([]byte(data))
}

// decodeServiceListingCursor decodes a cursor string back to (createdAt, uuidStr, error).
func decodeServiceListingCursor(cursor string) (time.Time, string, error) {
	data, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, "", err
	}
	parts := strings.SplitN(string(data), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, "", fmt.Errorf("invalid cursor format")
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, "", fmt.Errorf("invalid cursor timestamp: %w", err)
	}
	return t, parts[1], nil
}
