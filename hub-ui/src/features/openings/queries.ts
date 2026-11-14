import { useQuery } from "@tanstack/react-query";
import {
  type OpeningTagCatalog,
  openingTagCatalog,
} from "@vetchium/portal-ui/opening-tags";
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

const emptyOpeningTagCatalog: OpeningTagCatalog = new Map();

/**
 * The Opening tag catalog, read once per session (OPN-TAG-006). Empty until it
 * loads, so tags show as their OIDs meanwhile.
 */
export function useOpeningTags(): OpeningTagCatalog {
  const query = useQuery({
    queryKey: ["hub", "opening-tags"],
    queryFn: hubAPI.listOpeningTags,
    staleTime: Number.POSITIVE_INFINITY,
    select: openingTagCatalog,
  });
  return query.data ?? emptyOpeningTagCatalog;
}
