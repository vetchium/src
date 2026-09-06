import type { CountryCode } from "../common/localization.ts";
import { isCountryCode } from "../common/localization.ts";
import type { PaginationKey } from "../common/pagination.ts";
import { isPaginationKey } from "../common/pagination.ts";
export interface ListSignupRegionsRequest {
  resident_country: CountryCode;
  pagination_key?: PaginationKey;
}
export function validateListSignupRegionsRequest(
  request: ListSignupRegionsRequest,
): string[] {
  const fields: string[] = [];
  if (!isCountryCode(request.resident_country)) fields.push("resident_country");
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  )
    fields.push("pagination_key");
  return fields;
}
export interface SignupRegion {
  tenant_id: string;
  hosting_country: CountryCode;
  hub_url: string;
  recommended: boolean;
}
export interface ListSignupRegionsResponse {
  catalog_version: string;
  regions: SignupRegion[];
  next_pagination_key: PaginationKey | null;
}
