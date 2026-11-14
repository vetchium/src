import { type QueryKey, useQuery } from "@tanstack/react-query";
import type { ListOpeningTagsResponse } from "typespec/common/opening_tags";
import { type OpeningTagCatalog, openingTagCatalog } from "./names.ts";

export interface OpeningTagCatalogState {
  catalog: OpeningTagCatalog;
  /** The read failed, so pickers and filters say so instead of offering none. */
  failed: boolean;
}

const emptyOpeningTagCatalog: OpeningTagCatalog = new Map();

/**
 * The Opening tag catalog, read once per session (OPN-TAG-006). Empty until it
 * loads, so tags show as their OIDs meanwhile.
 */
export function useOpeningTagCatalog(
  queryKey: QueryKey,
  read: () => Promise<ListOpeningTagsResponse>,
): OpeningTagCatalogState {
  const query = useQuery({
    queryKey,
    queryFn: read,
    staleTime: Number.POSITIVE_INFINITY,
    select: openingTagCatalog,
  });
  return {
    catalog: query.data ?? emptyOpeningTagCatalog,
    failed: query.isError,
  };
}
