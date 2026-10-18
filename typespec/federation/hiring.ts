import type { ApplicantSnapshot } from "../hub/profile/snapshot.ts";
import { validateApplicantSnapshot } from "../hub/profile/snapshot.ts";
import type { HubUserDID } from "../hub/types.ts";
import { isHubUserDID } from "../hub/types.ts";
import {
  type ApplicationCoverNote,
  type ApplicationNumber,
  isApplicationCoverNote,
} from "../orgs/applications/applications.ts";
import type { OpeningNumber } from "../orgs/openings/types.ts";
import type { CommandKind } from "./commands.ts";

/**
 * The command a Hub user's home tenant sends to the Org's tenant to apply to
 * a published Opening. Its authority principal is the Org and its aggregate
 * id is the Opening number as decimal text.
 */
export const HubApplyKind: CommandKind = "hub-apply";

export interface HubApplyPayload {
  opening_number: OpeningNumber;
  applicant_did: HubUserDID;
  cover_note?: ApplicationCoverNote;
  snapshot: ApplicantSnapshot;
}

/** Trims the cover note and drops a blank one, leaving the caller's value. */
export function normalizeHubApplyPayload(
  payload: HubApplyPayload,
): HubApplyPayload {
  const { cover_note: note, ...rest } = payload;
  const trimmed = note?.trim();
  return trimmed ? { ...rest, cover_note: trimmed } : rest;
}

export function validateHubApplyPayload(payload: HubApplyPayload): string[] {
  const fields: string[] = [];
  if (!Number.isInteger(payload.opening_number) || payload.opening_number < 1) {
    fields.push("opening_number");
  }
  if (!isHubUserDID(payload.applicant_did)) fields.push("applicant_did");
  if (
    payload.cover_note !== undefined &&
    !isApplicationCoverNote(payload.cover_note)
  ) {
    fields.push("cover_note");
  }
  for (const field of validateApplicantSnapshot(payload.snapshot)) {
    fields.push(`snapshot.${field}`);
  }
  return fields;
}

/** The stored `201` body of a successful hub-apply. */
export interface HubApplyResult {
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
}
