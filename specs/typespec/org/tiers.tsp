import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

model OrgTier {
  tier_id: string;
  display_name: string;
  description: string;
  display_order: int32;
  org_users_cap?: int32;
  domains_verified_cap?: int32;
  suborgs_cap?: int32;
  marketplace_listings_cap?: int32;
  audit_retention_days?: int32;
  self_upgradeable: boolean;
}

model OrgTierUsage {
  org_users: int32;
  domains_verified: int32;
  suborgs: int32;
  marketplace_listings: int32;
}

model OrgSubscription {
  org_id: string;
  org_domain: string;
  current_tier: OrgTier;
  usage: OrgTierUsage;
  updated_at: string;
  note: string;
}

model ListOrgTiersRequest {}

model ListOrgTiersResponse {
  tiers: OrgTier[];
}

model GetMyOrgSubscriptionRequest {}

model SelfUpgradeOrgSubscriptionRequest {
  tier_id: string;
}

model AdminListOrgSubscriptionsRequest {
  filter_tier_id?: string;
  pagination_key?: string;
  limit?: int32;
}

model AdminListOrgSubscriptionsResponse {
  items: OrgSubscription[];
  next_pagination_key?: string;
}

model AdminSetOrgTierRequest {
  org_id: string;
  tier_id: string;
  reason: string;
}
