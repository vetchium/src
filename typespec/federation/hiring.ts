import type { DisplayName } from "../common/localization.ts";
import { isDisplayName } from "../common/localization.ts";
import {
  type ApplicationStatus,
  isApplicationStatus,
  isPendingActionKind,
  type PendingActionKind,
} from "../hub/applications/applications.ts";
import type { ApplicantSnapshot } from "../hub/profile/snapshot.ts";
import { validateApplicantSnapshot } from "../hub/profile/snapshot.ts";
import type { HubUserDID } from "../hub/types.ts";
import { isHubUserDID } from "../hub/types.ts";
import {
  type ApplicationCoverNote,
  type ApplicationNumber,
  isApplicationCoverNote,
  isApplicationNumber,
} from "../orgs/applications/applications.ts";
import type { OpeningNumber } from "../orgs/openings/types.ts";
import {
  isOrgDID,
  isOrgDomain,
  type OrgDID,
  type OrgDomain,
} from "../orgs/types.ts";
import type { CommandKind } from "./commands.ts";
import type { AggregateType, EventKind } from "./events.ts";

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

/**
 * The command a Hub user's home tenant sends to the Org's tenant to withdraw
 * the user's application. Its authority principal is the Org and its
 * aggregate id is the Opening number as decimal text.
 */
export const HubWithdrawKind: CommandKind = "hub-withdraw";

export interface HubWithdrawPayload {
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
  applicant_did: HubUserDID;
}

export function validateHubWithdrawPayload(
  payload: HubWithdrawPayload,
): string[] {
  const fields: string[] = [];
  if (!Number.isInteger(payload.opening_number) || payload.opening_number < 1) {
    fields.push("opening_number");
  }
  if (!isApplicationNumber(payload.application_number)) {
    fields.push("application_number");
  }
  if (!isHubUserDID(payload.applicant_did)) fields.push("applicant_did");
  return fields;
}

/** The stored `200` body of a successful hub-withdraw. */
export interface HubWithdrawResult {
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
}

/**
 * The event the Org's tenant enqueues on every change of an application for
 * the applicant Hub user's home tenant, versioned by the application's
 * version under the `org_application` aggregate
 * `<org did>:<opening number>:<application number>`.
 */
export const HubApplicationChangedKind: EventKind = "hub-application-changed";
export const OrgApplicationAggregate: AggregateType = "org_application";

export interface HubApplicationChangedPayload {
  org_did: OrgDID;
  org_domain: OrgDomain;
  org_display_name: DisplayName;
  opening_number: OpeningNumber;
  opening_title: string;
  application_number: ApplicationNumber;
  status: ApplicationStatus;
  pending_actions: PendingActionKind[];
  applied_at: string;
  last_activity_at: string;
}

export function validateHubApplicationChangedPayload(
  payload: HubApplicationChangedPayload,
): string[] {
  const fields: string[] = [];
  if (!isOrgDID(payload.org_did)) fields.push("org_did");
  if (!isOrgDomain(payload.org_domain)) fields.push("org_domain");
  if (!isDisplayName(payload.org_display_name)) fields.push("org_display_name");
  if (!Number.isInteger(payload.opening_number) || payload.opening_number < 1) {
    fields.push("opening_number");
  }
  if (payload.opening_title.trim() === "") fields.push("opening_title");
  if (!isApplicationNumber(payload.application_number)) {
    fields.push("application_number");
  }
  if (!isApplicationStatus(payload.status)) fields.push("status");
  if (
    !Array.isArray(payload.pending_actions) ||
    !payload.pending_actions.every(isPendingActionKind)
  ) {
    fields.push("pending_actions");
  }
  const applied = Date.parse(payload.applied_at);
  if (Number.isNaN(applied)) fields.push("applied_at");
  if (
    Number.isNaN(Date.parse(payload.last_activity_at)) ||
    Date.parse(payload.last_activity_at) < applied
  ) {
    fields.push("last_activity_at");
  }
  return fields;
}
