import type { HubUserDID } from "../types.ts";
import { isHubUserDID } from "../types.ts";
import {
  type ApplicationReference,
  validateApplicationReference,
} from "./applications.ts";

/**
 * The applicant's live read across the mesh; the Org's tenant answers only
 * for an applicant homed at the caller.
 */
export interface MeshGetApplicationRequest extends ApplicationReference {
  applicant_did: HubUserDID;
}

export function validateMeshGetApplicationRequest(
  request: MeshGetApplicationRequest,
): string[] {
  const fields = validateApplicationReference(request);
  if (!isHubUserDID(request.applicant_did)) fields.push("applicant_did");
  return fields;
}
