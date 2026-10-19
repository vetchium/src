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
  type BackgroundCheckNumber,
  type InterviewNumber,
  type InterviewRescheduleNote,
  isApplicationCoverNote,
  isApplicationNumber,
  isBackgroundCheckNumber,
  isInterviewNumber,
  isInterviewRescheduleNote,
  isOfferNumber,
  type OfferNumber,
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
 * The commands a Hub user's home tenant sends to the Org's tenant to answer
 * the offer the user read. Their authority principal is the Org and their
 * aggregate id is the Opening number as decimal text.
 */
export const HubAcceptOfferKind: CommandKind = "hub-accept-offer";
export const HubDeclineOfferKind: CommandKind = "hub-decline-offer";

export interface HubOfferResponsePayload {
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
  offer_number: OfferNumber;
  applicant_did: HubUserDID;
}

export function validateHubOfferResponsePayload(
  payload: HubOfferResponsePayload,
): string[] {
  const fields: string[] = [];
  if (!Number.isInteger(payload.opening_number) || payload.opening_number < 1) {
    fields.push("opening_number");
  }
  if (!isApplicationNumber(payload.application_number)) {
    fields.push("application_number");
  }
  if (!isOfferNumber(payload.offer_number)) fields.push("offer_number");
  if (!isHubUserDID(payload.applicant_did)) fields.push("applicant_did");
  return fields;
}

/** The stored `200` body of a successful offer answer. */
export interface HubOfferResponseResult {
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
  offer_number: OfferNumber;
}

/**
 * The commands a Hub user's home tenant sends to the Org's tenant to accept
 * an interview or ask for it to move. Their authority principal is the Org
 * and their aggregate id is the Opening number as decimal text.
 */
export const HubAcceptInterviewKind: CommandKind = "hub-accept-interview";
export const HubRescheduleInterviewKind: CommandKind =
  "hub-request-interview-reschedule";

export interface HubAcceptInterviewPayload {
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
  interview_number: InterviewNumber;
  applicant_did: HubUserDID;
}

export function validateHubAcceptInterviewPayload(
  payload: HubAcceptInterviewPayload,
): string[] {
  const fields: string[] = [];
  if (!Number.isInteger(payload.opening_number) || payload.opening_number < 1) {
    fields.push("opening_number");
  }
  if (!isApplicationNumber(payload.application_number)) {
    fields.push("application_number");
  }
  if (!isInterviewNumber(payload.interview_number)) {
    fields.push("interview_number");
  }
  if (!isHubUserDID(payload.applicant_did)) fields.push("applicant_did");
  return fields;
}

export interface HubRescheduleInterviewPayload
  extends HubAcceptInterviewPayload {
  note: InterviewRescheduleNote;
}

/** Trims the note, leaving the caller's value. */
export function normalizeHubRescheduleInterviewPayload(
  payload: HubRescheduleInterviewPayload,
): HubRescheduleInterviewPayload {
  return { ...payload, note: payload.note.trim() };
}

export function validateHubRescheduleInterviewPayload(
  payload: HubRescheduleInterviewPayload,
): string[] {
  const fields = validateHubAcceptInterviewPayload(payload);
  if (!isInterviewRescheduleNote(payload.note)) fields.push("note");
  return fields;
}

export interface HubInterviewResponseResult {
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
  interview_number: InterviewNumber;
}

/**
 * The commands a Hub user's home tenant sends to the Org's tenant to answer a
 * background-check consent request. Their authority principal is the Org and
 * their aggregate id is the Opening number as decimal text.
 */
export const HubGiveConsentKind: CommandKind =
  "hub-give-background-check-consent";
export const HubDeclineConsentKind: CommandKind =
  "hub-decline-background-check-consent";

export interface HubBackgroundCheckConsentPayload {
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
  check_number: BackgroundCheckNumber;
  applicant_did: HubUserDID;
}

export function validateHubBackgroundCheckConsentPayload(
  payload: HubBackgroundCheckConsentPayload,
): string[] {
  const fields: string[] = [];
  if (!Number.isInteger(payload.opening_number) || payload.opening_number < 1) {
    fields.push("opening_number");
  }
  if (!isApplicationNumber(payload.application_number)) {
    fields.push("application_number");
  }
  if (!isBackgroundCheckNumber(payload.check_number)) {
    fields.push("check_number");
  }
  if (!isHubUserDID(payload.applicant_did)) fields.push("applicant_did");
  return fields;
}

export interface HubBackgroundCheckConsentResult {
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
  check_number: BackgroundCheckNumber;
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
  /** Why the applicant gets an email (HP-GEN-006); absent when they caused it. */
  notice?: ApplicationNotice;
}

export const applicationNoticeValues = [
  "status_changed",
  "interview_scheduled",
  "interview_changed",
  "interview_cancelled",
  "consent_requested",
  "offer_extended",
  "offer_withdrawn",
  "offer_expiring",
  "offer_expired",
] as const;

export type ApplicationNotice = (typeof applicationNoticeValues)[number];

export function isApplicationNotice(
  value: unknown,
): value is ApplicationNotice {
  return (applicationNoticeValues as readonly unknown[]).includes(value);
}

/** The event retention enqueues so the projection row is deleted. */
export const HubApplicationRemovedKind: EventKind = "hub-application-removed";

export interface HubApplicationRemovedPayload {
  org_did: OrgDID;
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
}

export function validateHubApplicationRemovedPayload(
  payload: HubApplicationRemovedPayload,
): string[] {
  const fields: string[] = [];
  if (!isOrgDID(payload.org_did)) fields.push("org_did");
  if (!Number.isInteger(payload.opening_number) || payload.opening_number < 1) {
    fields.push("opening_number");
  }
  if (!isApplicationNumber(payload.application_number)) {
    fields.push("application_number");
  }
  return fields;
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
  if (payload.notice !== undefined && !isApplicationNotice(payload.notice)) {
    fields.push("notice");
  }
  return fields;
}
