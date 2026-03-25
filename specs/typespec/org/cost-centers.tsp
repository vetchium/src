import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

model AddCostCenterRequest {
  id: string;
  display_name: string;
  notes?: string;
}

model UpdateCostCenterRequest {
  id: string;
  display_name: string;
  status: string;
  notes?: string;
}

model CostCenter {
  cost_center_id: string;
  id: string;
  display_name: string;
  status: string;
  notes?: string;
  created_at: string;
}

model ListCostCentersRequest {
  filter_status?: string;
  pagination_key?: string;
}

model ListCostCentersResponse {
  cost_centers: CostCenter[];
  next_pagination_key?: string;
}

@route("/org")
interface OrgCostCenters {
  @route("/add-cost-center") @post addCostCenter(@body body: AddCostCenterRequest): CostCenter | BadRequestResponse;
  @route("/update-cost-center") @post updateCostCenter(@body body: UpdateCostCenterRequest): CostCenter | BadRequestResponse;
  @route("/list-cost-centers") @post listCostCenters(@body body: ListCostCentersRequest): ListCostCentersResponse | BadRequestResponse;
}
