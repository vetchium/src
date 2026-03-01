import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// ============================================
// Cost Centers
// ============================================

model CostCenter {
  @doc("User-defined immutable identifier for the cost center (unique per employer)")
  id: string;

  @doc("Human-readable display name for the cost center")
  display_name: string;

  @doc("Status of the cost center")
  status: string;

  @doc("Optional notes about the cost center")
  notes?: string;

  @doc("Timestamp when the cost center was created (RFC3339)")
  created_at: string;
}

model AddCostCenterRequest {
  @doc("User-defined identifier (1-64 chars, immutable after creation). Must match pattern ^[a-z0-9][a-z0-9_-]*$ — lowercase letters, digits, hyphens, underscores only; must start with a letter or digit.")
  id: string;

  @doc("Human-readable display name (1-64 chars)")
  display_name: string;

  @doc("Optional notes (max 500 chars)")
  notes?: string;
}

model UpdateCostCenterRequest {
  @doc("Identifier of the cost center to update. Must match pattern ^[a-z0-9][a-z0-9_-]*$")
  id: string;

  @doc("New display name (1-64 chars)")
  display_name: string;

  @doc("New status: 'enabled' or 'disabled'")
  status: string;

  @doc("New notes (max 500 chars)")
  notes?: string;
}

model ListCostCentersRequest {
  @doc("Optional cursor for keyset pagination")
  cursor?: string;

  @doc("Optional status filter: 'enabled' or 'disabled'")
  filter_status?: string;

  @doc("Maximum number of results to return (default 20, max 100)")
  limit?: int32;
}

model ListCostCentersResponse {
  @doc("List of cost centers")
  items: CostCenter[];

  @doc("Cursor for the next page of results (empty if no more results)")
  next_cursor: string;
}

@route("/employer/add-cost-center")
@post
op addCostCenter(@body request: AddCostCenterRequest): {
  @statusCode statusCode: 201;
  @body costCenter: CostCenter;
} | {
  @statusCode statusCode: 400;
} | {
  @statusCode statusCode: 401;
} | {
  @statusCode statusCode: 403;
} | {
  @statusCode statusCode: 409;
};

@route("/employer/update-cost-center")
@post
op updateCostCenter(@body request: UpdateCostCenterRequest): {
  @statusCode statusCode: 200;
  @body costCenter: CostCenter;
} | {
  @statusCode statusCode: 400;
} | {
  @statusCode statusCode: 401;
} | {
  @statusCode statusCode: 403;
} | {
  @statusCode statusCode: 404;
};

@route("/employer/list-cost-centers")
@post
op listCostCenters(@body request: ListCostCentersRequest): {
  @statusCode statusCode: 200;
  @body response: ListCostCentersResponse;
} | {
  @statusCode statusCode: 400;
} | {
  @statusCode statusCode: 401;
} | {
  @statusCode statusCode: 403;
};
