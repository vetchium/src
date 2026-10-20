import { useQuery } from "@tanstack/react-query";
import type {
  ApplicationReference,
  MyApplicationSummary,
} from "typespec/hub/applications/applications";
import { hubAPI } from "../../api/hub";

export const applicationsQueryKey = ["hub", "applications"] as const;

// The list API is keyset paginated at 50. A person's applications are few, so
// the portal follows every page: the tab counts, the navigation badge, and the
// Home card then show real figures instead of those of the first page.
const maxPages = 40;

async function listAllApplications(): Promise<MyApplicationSummary[]> {
  const applications: MyApplicationSummary[] = [];
  let paginationKey: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await hubAPI.listMyApplications({
      limit: 50,
      ...(paginationKey !== undefined && { pagination_key: paginationKey }),
    });
    applications.push(...result.applications);
    paginationKey = result.next_pagination_key;
    if (paginationKey === undefined) break;
  }
  return applications;
}

export function useMyApplicationsQuery(enabled = true) {
  return useQuery({
    queryKey: [...applicationsQueryKey, "list"],
    queryFn: listAllApplications,
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

/** Applications whose next step is the applicant's. */
export function needsAnswer(application: MyApplicationSummary): boolean {
  return application.pending_actions.length > 0;
}
