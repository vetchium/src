import { useQuery } from "@tanstack/react-query";
import type { ListRequest } from "../../../../typespec/admin/hub-signup-domains/domains.ts";
import { listHubSignupDomains } from "./api";

export const hubSignupDomainsQueryKey = [
  "admin",
  "hub-signup-domains",
] as const;

export function useHubSignupDomainsQuery(request: ListRequest) {
  return useQuery({
    queryKey: [...hubSignupDomainsQueryKey, request],
    queryFn: () => listHubSignupDomains(request),
    placeholderData: (previous) => previous,
  });
}
