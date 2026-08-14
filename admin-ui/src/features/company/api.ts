import type { CompanyRegionalDefaultsResponse } from "../../../../typespec/admin/company/regional.ts";
import { requestJson } from "../../api/client";

export function getCompanyRegionalDefaults(): Promise<CompanyRegionalDefaultsResponse> {
  return requestJson("/admin/company-regional-defaults", { method: "GET" });
}
