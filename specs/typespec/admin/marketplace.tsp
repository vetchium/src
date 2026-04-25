import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";
import "../org/marketplace.tsp";

using TypeSpec.Http;

namespace Vetchium;

// Admin marketplace types are defined in org/marketplace.tsp under the // ---- Admin ---- section.
// Admin routes operate on:
//   Capabilities: POST /admin/marketplace/capability/{create,update,list}
//   Listings:     POST /admin/marketplace/listing/{list,suspend,reinstate}
//   Subscriptions:POST /admin/marketplace/subscription/{list,cancel}
//
// Org-side approve/reject (OrgApproveListingRequest, OrgRejectListingRequest) are
// intra-org operations performed by org:superadmin, not the Vetchium admin portal.
