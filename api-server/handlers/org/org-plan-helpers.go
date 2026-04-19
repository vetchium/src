package org

import (
	"context"
	"fmt"

	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	orgtypes "vetchium-api-server.typespec/org"
)

// buildOrgPlan assembles the OrgPlan API response from DB rows.
// It fetches usage counts from global and regional DBs.
func buildOrgPlan(
	ctx context.Context,
	sub globaldb.GetOrgPlanRow,
	orgDomain string,
	global *globaldb.Queries,
	regional *regionaldb.Queries,
) (orgtypes.OrgPlan, error) {
	orgID := sub.OrgID

	// Count usage
	orgUsers, err := global.CountOrgUsers(ctx, orgID)
	if err != nil {
		return orgtypes.OrgPlan{}, fmt.Errorf("count org users: %w", err)
	}
	domainsVerified, err := regional.CountVerifiedDomainsForOrg(ctx, orgID)
	if err != nil {
		return orgtypes.OrgPlan{}, fmt.Errorf("count verified domains: %w", err)
	}
	suborgs, err := regional.CountSubOrgsForOrg(ctx, orgID)
	if err != nil {
		return orgtypes.OrgPlan{}, fmt.Errorf("count suborgs: %w", err)
	}

	marketplaceListings, err := regional.CountActiveOrPendingListingsForOrg(ctx, orgID)
	if err != nil {
		return orgtypes.OrgPlan{}, fmt.Errorf("count marketplace listings: %w", err)
	}

	plan := buildPlan(sub)

	return orgtypes.OrgPlan{
		OrgID:       uuidToString(orgID),
		OrgDomain:   orgDomain,
		CurrentPlan: plan,
		Usage: orgtypes.PlanUsage{
			OrgUsers:            orgUsers,
			DomainsVerified:     domainsVerified,
			Suborgs:             suborgs,
			MarketplaceListings: marketplaceListings,
		},
		UpdatedAt: sub.UpdatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
		Note:      sub.Note,
	}, nil
}

// buildPlan converts a GetOrgPlanRow into a Plan response.
func buildPlan(sub globaldb.GetOrgPlanRow) orgtypes.Plan {
	plan := orgtypes.Plan{
		PlanID:          sub.CurrentPlanID,
		DisplayName:     sub.PlanKey, // will be overwritten from translations if available
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

// buildPlanFromRow converts a ListPlansRow into a Plan response.
func buildPlanFromRow(row globaldb.ListPlansRow) orgtypes.Plan {
	plan := orgtypes.Plan{
		PlanID:          row.PlanID,
		DisplayName:     row.DisplayName,
		Description:     row.Description,
		DisplayOrder:    row.DisplayOrder,
		SelfUpgradeable: row.SelfUpgradeable,
	}
	if row.OrgUsersCap.Valid {
		v := row.OrgUsersCap.Int32
		plan.OrgUsersCap = &v
	}
	if row.DomainsVerifiedCap.Valid {
		v := row.DomainsVerifiedCap.Int32
		plan.DomainsVerifiedCap = &v
	}
	if row.SuborgsCap.Valid {
		v := row.SuborgsCap.Int32
		plan.SuborgsCap = &v
	}
	if row.MarketplaceListingsCap.Valid {
		v := row.MarketplaceListingsCap.Int32
		plan.MarketplaceListingsCap = &v
	}
	if row.AuditRetentionDays.Valid {
		v := row.AuditRetentionDays.Int32
		plan.AuditRetentionDays = &v
	}
	return plan
}
