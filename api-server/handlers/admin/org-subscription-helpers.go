package admin

import (
	"vetchium-api-server.gomodule/internal/db/globaldb"
	orgtypes "vetchium-api-server.typespec/org"
)

// buildOrgTier converts a GetOrgSubscriptionRow into an OrgTier response.
func buildOrgTier(sub globaldb.GetOrgSubscriptionRow) orgtypes.OrgTier {
	tier := orgtypes.OrgTier{
		TierID:          sub.CurrentTierID,
		DisplayName:     sub.TierKey,
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
