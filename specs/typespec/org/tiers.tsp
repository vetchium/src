import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

model Plan {
  plan_id: string;
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

model PlanUsage {
  org_users: int32;
  domains_verified: int32;
  suborgs: int32;
  marketplace_listings: int32;
}

model OrgPlan {
  org_id: string;
  org_domain: string;
  current_plan: Plan;
  usage: PlanUsage;
  updated_at: string;
  note: string;
}

model ListPlansRequest {}

model ListPlansResponse {
  plans: Plan[];
}

model GetMyOrgPlanRequest {}

model UpgradeOrgPlanRequest {
  plan_id: string;
}

model AdminListOrgPlansRequest {
  filter_plan_id?: string;
  filter_domain?: string;
  pagination_key?: string;
  limit?: int32;
}

model AdminListOrgPlansResponse {
  org_plans: OrgPlan[];
  next_pagination_key?: string;
}

model AdminSetOrgPlanRequest {
  org_id: string;
  plan_id: string;
  reason: string;
}
