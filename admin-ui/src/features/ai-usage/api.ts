import type {
  GetOrgAIUsageTextRequest,
  ListOrgAIUsageRequest,
  ListOrgAIUsageResponse,
} from "typespec/admin/ai-usage/usage";
import type { AIUsageText } from "typespec/orgs/ai/types";
import { requestJson } from "../../api/client";

export function listOrgAIUsage(
  request: ListOrgAIUsageRequest,
): Promise<ListOrgAIUsageResponse> {
  return requestJson("/admin/list-org-ai-usage", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

/** Every successful read is recorded in the audit log. */
export function getOrgAIUsageText(
  request: GetOrgAIUsageTextRequest,
): Promise<AIUsageText> {
  return requestJson("/admin/get-org-ai-usage-text", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
