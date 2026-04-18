package org

import (
	"context"
	"fmt"

	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	orgtypes "vetchium-api-server.typespec/org"
)

// buildOrgSubscription assembles the OrgSubscription API response from DB rows.
// It fetches usage counts from global and regional DBs.
func buildOrgSubscription(
	ctx context.Context,
	sub globaldb.GetOrgSubscriptionRow,
	orgDomain string,
	global *globaldb.Queries,
	regional *regionaldb.Queries,
) (orgtypes.OrgSubscription, error) {
	orgID := sub.OrgID

	// Count usage
	orgUsers, err := global.CountOrgUsers(ctx, orgID)
	if err != nil {
		return orgtypes.OrgSubscription{}, fmt.Errorf("count org users: %w", err)
	}
	domainsVerified, err := regional.CountVerifiedDomainsForOrg(ctx, orgID)
	if err != nil {
		return orgtypes.OrgSubscription{}, fmt.Errorf("count verified domains: %w", err)
	}
	suborgs, err := regional.CountSubOrgsForOrg(ctx, orgID)
	if err != nil {
		return orgtypes.OrgSubscription{}, fmt.Errorf("count suborgs: %w", err)
	}

	marketplaceListings, err := regional.CountActiveOrPendingListingsForOrg(ctx, orgID)
	if err != nil {
		return orgtypes.OrgSubscription{}, fmt.Errorf("count marketplace listings: %w", err)
	}

	tier := buildOrgTier(sub)

	return orgtypes.OrgSubscription{
		OrgID:       uuidToString(orgID),
		OrgDomain:   orgDomain,
		CurrentTier: tier,
		Usage: orgtypes.OrgTierUsage{
			OrgUsers:            orgUsers,
			DomainsVerified:     domainsVerified,
			Suborgs:             suborgs,
			MarketplaceListings: marketplaceListings,
		},
		UpdatedAt: sub.UpdatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
		Note:      sub.Note,
	}, nil
}

// buildOrgTier converts a GetOrgSubscriptionRow into an OrgTier response.
func buildOrgTier(sub globaldb.GetOrgSubscriptionRow) orgtypes.OrgTier {
	tier := orgtypes.OrgTier{
		TierID:          sub.CurrentTierID,
		DisplayName:     sub.TierKey, // will be overwritten from translations if available
		Description:     "",
		DisplayOrder:    sub.DisplayOrder,
		SelfUpgradeable: sub.SelfUpgradeable,
	}
	if sub.OrgUsersCap.Valid {
		v := sub.OrgUsersCap.Int32
		tier.OrgUsersCap = &v
	}
	if sub.DomainsVerifiedCap.Valid {
		v := sub.DomainsVerifiedCap.Int32
		tier.DomainsVerifiedCap = &v
	}
	if sub.SuborgsCap.Valid {
		v := sub.SuborgsCap.Int32
		tier.SuborgsCap = &v
	}
	if sub.MarketplaceListingsCap.Valid {
		v := sub.MarketplaceListingsCap.Int32
		tier.MarketplaceListingsCap = &v
	}
	if sub.AuditRetentionDays.Valid {
		v := sub.AuditRetentionDays.Int32
		tier.AuditRetentionDays = &v
	}
	return tier
}

// buildOrgTierFromRow converts a ListOrgTiersRow into an OrgTier response.
func buildOrgTierFromRow(row globaldb.ListOrgTiersRow) orgtypes.OrgTier {
	tier := orgtypes.OrgTier{
		TierID:          row.TierID,
		DisplayName:     row.DisplayName,
		Description:     row.Description,
		DisplayOrder:    row.DisplayOrder,
		SelfUpgradeable: row.SelfUpgradeable,
	}
	if row.OrgUsersCap.Valid {
		v := row.OrgUsersCap.Int32
		tier.OrgUsersCap = &v
	}
	if row.DomainsVerifiedCap.Valid {
		v := row.DomainsVerifiedCap.Int32
		tier.DomainsVerifiedCap = &v
	}
	if row.SuborgsCap.Valid {
		v := row.SuborgsCap.Int32
		tier.SuborgsCap = &v
	}
	if row.MarketplaceListingsCap.Valid {
		v := row.MarketplaceListingsCap.Int32
		tier.MarketplaceListingsCap = &v
	}
	if row.AuditRetentionDays.Valid {
		v := row.AuditRetentionDays.Int32
		tier.AuditRetentionDays = &v
	}
	return tier
}
