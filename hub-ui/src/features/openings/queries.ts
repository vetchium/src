import { useQuery } from "@tanstack/react-query";
import type { ListOrgOpeningsRequest } from "typespec/hub/openings/public";
import { hubAPI } from "../../api/hub";

export function useOrgOpeningsQuery(
  request: ListOrgOpeningsRequest,
  enabled = true,
) {
  return useQuery({
    queryKey: ["hub", "org-openings", request],
    queryFn: () => hubAPI.listOrgOpenings(request),
    retry: false,
    enabled,
  });
}

export function useOrgOpeningQuery(
  domain: string,
  openingNumber: number,
  enabled = true,
) {
  return useQuery({
    queryKey: ["hub", "org-opening", domain, openingNumber],
    queryFn: () =>
      hubAPI.getOrgOpening({ domain, opening_number: openingNumber }),
    retry: false,
    enabled,
  });
}
