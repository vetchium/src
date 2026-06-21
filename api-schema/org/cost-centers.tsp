import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

model AddCostCenterRequest {
  cost_center_id: string;
  display_name: string;
  notes?: string;
}

model UpdateCostCenterRequest {
  cost_center_id: string;
  display_name: string;
  status: string;
  notes?: string;
}

model CostCenter {
  cost_center_id: string;
  display_name: string;
  status: string;
  notes?: string;
  created_at: string;
}

model ListCostCentersRequest {
  filter_status?: string;
  pagination_key?: string;
  limit?: int32;
}

model ListCostCentersResponse {
  cost_centers: CostCenter[];
  next_pagination_key?: string;
}

@route("/org")
interface OrgCostCenters {
  @route("/create-cost-center") @post addCostCenter(@body body: AddCostCenterRequest): CostCenter | BadRequestResponse;
  @route("/update-cost-center") @post updateCostCenter(@body body: UpdateCostCenterRequest): CostCenter | BadRequestResponse;
  @route("/list-cost-centers") @post listCostCenters(@body body: ListCostCentersRequest): ListCostCentersResponse | BadRequestResponse;
}
