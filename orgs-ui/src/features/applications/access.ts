import { holds, ManageCandidacies } from "typespec/orgs/authorization/types";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { useMyInfoQuery } from "../account/queries";

/**
 * Whether the caller may act on the Opening's applications: its hiring
 * manager or recruiter, or a holder of `org:manage_candidacies`. The API
 * decides; this only keeps actions off screens that would be refused.
 */
export function useCanActOnApplications(opening: OrgOpening | undefined) {
  const { data: me } = useMyInfoQuery();
  if (me === undefined || opening === undefined) return false;
  return (
    holds(me.permissions, ManageCandidacies) ||
    opening.hiring_manager?.email === me.email_address ||
    opening.recruiter?.email === me.email_address
  );
}
