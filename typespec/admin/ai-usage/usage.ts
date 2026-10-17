import {
  isPageSize,
  isPaginationKey,
  type PageSize,
  type PaginationKey,
} from "../../common/pagination.ts";
import {
  type AIUsage,
  type AIUsageID,
  isAIUsageID,
} from "../../orgs/ai/types.ts";
import {
  isOrgDomain,
  normalizeOrgDomain,
  type OrgDomain,
} from "../../orgs/types.ts";

export interface ListOrgAIUsageRequest {
  org_domain: OrgDomain;
  pagination_key?: PaginationKey;
  limit?: PageSize;
}

export interface ListOrgAIUsageResponse {
  entries: AIUsage[];
  next_pagination_key?: PaginationKey;
}

export function validateListOrgAIUsageRequest(
  request: ListOrgAIUsageRequest,
): string[] {
  const fields: string[] = [];
  if (!isOrgDomain(normalizeOrgDomain(request.org_domain)))
    fields.push("org_domain");
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  )
    fields.push("pagination_key");
  if (request.limit !== undefined && !isPageSize(request.limit))
    fields.push("limit");
  return fields;
}

export interface GetOrgAIUsageTextRequest {
  org_domain: OrgDomain;
  usage_id: AIUsageID;
}

export function validateGetOrgAIUsageTextRequest(
  request: GetOrgAIUsageTextRequest,
): string[] {
  const fields: string[] = [];
  if (!isOrgDomain(normalizeOrgDomain(request.org_domain)))
    fields.push("org_domain");
  if (!isAIUsageID(request.usage_id)) fields.push("usage_id");
  return fields;
}
