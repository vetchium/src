import type {
  CreateRequest,
  Domain,
  ListRequest,
  ListResponse,
  UpdateRequest,
} from "../../../../typespec/admin/hub-signup-domains/domains.ts";
import { requestJson } from "../../api/client";

export function listHubSignupDomains(
  request: ListRequest,
): Promise<ListResponse> {
  return requestJson("/admin/list-hub-signup-domains", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function createHubSignupDomain(request: CreateRequest): Promise<Domain> {
  return requestJson("/admin/create-hub-signup-domain", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function updateHubSignupDomain(request: UpdateRequest): Promise<Domain> {
  return requestJson("/admin/update-hub-signup-domain", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
