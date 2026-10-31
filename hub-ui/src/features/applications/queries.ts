import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { PaginationKey } from "typespec/common/pagination";
import {
  type ApplicationReference,
  type MyApplicationSummary,
  type MyApplicationView,
  normalizeListMyApplicationsRequest,
} from "typespec/hub/applications/applications";
import type { OpeningNumber } from "typespec/orgs/openings/types";
import type { OrgDomain } from "typespec/orgs/types";
import { ApplicationNotFoundError } from "typespec/problem/hub/applications";
import { isProblem } from "../../api/client";
import { hubAPI } from "../../api/hub";

export const applicationsQueryKey = ["hub", "applications"] as const;

const pageSize = 20;

export interface MyApplicationFilters {
  query?: string;
  awaitingAnswer?: boolean;
}

/** One view of the list, filtered, a page at a time, newest activity first. */
export function useMyApplicationsQuery(
  view: MyApplicationView,
  filters: MyApplicationFilters,
) {
  const request = normalizeListMyApplicationsRequest({
    view,
    ...(filters.query !== undefined && { query: filters.query }),
    ...(filters.awaitingAnswer === true && { awaiting_answer: true }),
  });
  return useInfiniteQuery({
    queryKey: [
      ...applicationsQueryKey,
      "list",
      view,
      request.query ?? "",
      request.awaiting_answer === true,
    ],
    queryFn: ({ pageParam }) =>
      hubAPI.listMyApplications({
        ...request,
        limit: pageSize,
        ...(pageParam !== undefined && { pagination_key: pageParam }),
      }),
    initialPageParam: undefined as PaginationKey | undefined,
    getNextPageParam: (page) => page.next_pagination_key,
    retry: false,
  });
}

export function useMyApplicationCountsQuery(enabled = true) {
  return useQuery({
    queryKey: [...applicationsQueryKey, "counts"],
    queryFn: () => hubAPI.myApplicationCounts(),
    retry: false,
    enabled,
  });
}

/** The caller's application to an Opening, or null when there is none. */
export function useMyOpeningApplicationQuery(
  domain: OrgDomain,
  openingNumber: OpeningNumber,
  enabled = true,
) {
  return useQuery({
    queryKey: [...applicationsQueryKey, "opening", domain, openingNumber],
    queryFn: async (): Promise<MyApplicationSummary | null> => {
      try {
        return await hubAPI.findMyOpeningApplication({
          domain,
          opening_number: openingNumber,
        });
      } catch (error) {
        if (isProblem(error, ApplicationNotFoundError.type)) return null;
        throw error;
      }
    },
    retry: false,
    enabled,
  });
}

export function useMyApplicationQuery(
  reference: ApplicationReference,
  enabled = true,
) {
  return useQuery({
    queryKey: [
      ...applicationsQueryKey,
      "detail",
      reference.domain,
      reference.opening_number,
      reference.application_number,
    ],
    queryFn: () => hubAPI.getMyApplication(reference),
    retry: false,
    enabled,
  });
}
