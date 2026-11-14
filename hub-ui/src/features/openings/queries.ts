import { useQuery } from "@tanstack/react-query";
import {
  type OpeningTagCatalogState,
  useOpeningTagCatalog,
} from "@vetchium/portal-ui/opening-tags";
import { useEffect, useState } from "react";
import type { ListOrgOpeningsRequest } from "typespec/hub/openings/public";
import type {
  SearchOpeningsRequest,
  SuggestOpeningOrgsRequest,
} from "typespec/hub/openings/search";
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

const openingTagsQueryKey = ["hub", "opening-tags"] as const;

export function useOpeningTags(): OpeningTagCatalogState {
  return useOpeningTagCatalog(openingTagsQueryKey, hubAPI.listOpeningTags);
}

export function useOpeningSearchQuery(request: SearchOpeningsRequest) {
  return useQuery({
    queryKey: ["hub", "opening-search", request],
    queryFn: () => hubAPI.searchOpenings(request),
    retry: false,
  });
}

const suggestionDelayMs = 300;

/**
 * Orgs whose name or domain matches `typed` once typing pauses; asks nothing
 * outside the API's 2–100 character query. `settled` is false while typing
 * has not paused, so no answer yet reflects the text.
 */
export function useOpeningOrgSuggestions(
  region: SuggestOpeningOrgsRequest["region"],
  typed: string,
) {
  const [query, setQuery] = useState(typed.trim());
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), suggestionDelayMs);
    return () => clearTimeout(timer);
  }, [typed]);
  const size = [...query].length;
  const request: SuggestOpeningOrgsRequest = {
    query,
    ...(region !== undefined && { region }),
  };
  const suggestions = useQuery({
    queryKey: ["hub", "opening-org-suggestions", request],
    queryFn: () => hubAPI.suggestOpeningOrgs(request),
    retry: false,
    enabled: size >= 2 && size <= 100,
  });
  return { suggestions, settled: query === typed.trim() };
}
