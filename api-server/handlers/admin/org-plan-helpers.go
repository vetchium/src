package admin

import (
	"vetchium-api-server.gomodule/internal/db/globaldb"
	orgtypes "vetchium-api-server.typespec/org"
)

// buildPlan converts a GetOrgPlanRow into a Plan response.
func buildPlan(sub globaldb.GetOrgPlanRow) orgtypes.Plan {
	plan := orgtypes.Plan{
		PlanID:          sub.CurrentPlanID,
		DisplayName:     sub.PlanKey,
		Description:     "",
		DisplayOrder:    sub.DisplayOrder,
		SelfUpgradeable: sub.SelfUpgradeable,
	}
	if sub.OrgUsersCap.Valid {
		v := sub.OrgUsersCap.Int32
		plan.OrgUsersCap = &v
	}
	if sub.DomainsVerifiedCap.Valid {
		v := sub.DomainsVerifiedCap.Int32
		plan.DomainsVerifiedCap = &v
	}
	if sub.SuborgsCap.Valid {
		v := sub.SuborgsCap.Int32
		plan.SuborgsCap = &v
	}
	if sub.MarketplaceListingsCap.Valid {
		v := sub.MarketplaceListingsCap.Int32
		plan.MarketplaceListingsCap = &v
	}
	if sub.AuditRetentionDays.Valid {
		v := sub.AuditRetentionDays.Int32
		plan.AuditRetentionDays = &v
	}
	return plan
}
