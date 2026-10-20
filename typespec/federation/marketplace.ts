import {
  type EmailAddress,
  isEmailAddress,
  normalizeEmailAddress,
} from "../common/common.ts";
import type { Capability } from "../orgs/marketplace/capabilities.ts";
import { isCapability } from "../orgs/marketplace/capabilities.ts";
import type {
  Engagement,
  EngagementID,
  EngagementParty,
  EngagementState,
  EngagementVersion,
} from "../orgs/marketplace/engagements.ts";
import {
  isEngagementID,
  isEngagementParty,
  isEngagementState,
  maxEngagementNote,
  maxEngagementReference,
} from "../orgs/marketplace/engagements.ts";
import { isStorableText } from "../orgs/marketplace/listings.ts";
import type {
  ChangeInterviewRequest,
  InterviewReference,
  RecordAssessmentRequest,
  RecordBackgroundCheckResultRequest,
  RecordInterviewOutcomeRequest,
  ScheduleInterviewRequest,
  SubmitInterviewFeedbackRequest,
  WorkID,
} from "../orgs/marketplace/work/work.ts";
import {
  normalizeChangeInterviewRequest,
  normalizeRecordAssessmentRequest,
  normalizeRecordBackgroundCheckResultRequest,
  normalizeScheduleInterviewRequest,
  normalizeSubmitInterviewFeedbackRequest,
  validateChangeInterviewRequest,
  validateInterviewReference,
  validateRecordAssessmentRequest,
  validateRecordBackgroundCheckResultRequest,
  validateRecordInterviewOutcomeRequest,
  validateScheduleInterviewRequest,
  validateSubmitInterviewFeedbackRequest,
  validateWorkReference,
} from "../orgs/marketplace/work/work.ts";
import {
  isOrgDID,
  isOrgDomain,
  type OrgDID,
  type OrgDomain,
} from "../orgs/types.ts";
import type { CommandKind } from "./commands.ts";
import type { AggregateType, EventKind } from "./events.ts";

/**
 * Engagement commands are sent by the provider's tenant to the consumer's
 * tenant, which is authoritative for the engagement. Their authority
 * principal is the consumer Org and their aggregate id is the engagement id.
 */
export const EngagementAcceptKind: CommandKind = "engagement-accept";
export const EngagementDeclineKind: CommandKind = "engagement-decline";
export const EngagementEndKind: CommandKind = "engagement-end";
export const EngagementSetReferenceKind: CommandKind =
  "engagement-set-reference";

/**
 * The event the consumer's tenant enqueues on every change of an engagement
 * for the provider's tenant, which keeps one non-authoritative projection row
 * per engagement.
 */
export const EngagementChangedKind: EventKind = "engagement-changed";

/** Versions engagement-changed by the engagement's version; its aggregate id
 * is the engagement id. */
export const EngagementAggregate: AggregateType = "org_engagement";

/** One Org of an engagement as the consumer's tenant recorded it. */
export interface EngagementSnapshotOrg {
  org_did: OrgDID;
  domain: OrgDomain;
  display_name: string;
}

function validateSnapshotOrg(
  org: EngagementSnapshotOrg,
  prefix: string,
): string[] {
  const fields: string[] = [];
  if (!isOrgDID(org.org_did)) fields.push(`${prefix}.org_did`);
  if (!isOrgDomain(org.domain)) fields.push(`${prefix}.domain`);
  if (org.display_name.trim() === "") fields.push(`${prefix}.display_name`);
  return fields;
}

/**
 * An engagement in full: the stored `200` result of every engagement command
 * and the payload of engagement-changed.
 */
export interface EngagementSnapshot {
  engagement_id: EngagementID;
  version: EngagementVersion;
  consumer: EngagementSnapshotOrg;
  provider: EngagementSnapshotOrg;
  capability: Capability;
  state: EngagementState;
  message?: string;
  consumer_reference?: string;
  provider_reference?: string;
  end_note?: string;
  ended_by?: EngagementParty;
  proposed_at: string;
  expires_at: string;
  decided_at?: string;
  ended_at?: string;
  updated_at: string;
}

export function validateEngagementSnapshot(
  snapshot: EngagementSnapshot,
): string[] {
  const fields: string[] = [];
  if (!isEngagementID(snapshot.engagement_id)) fields.push("engagement_id");
  if (!Number.isInteger(snapshot.version) || snapshot.version < 1)
    fields.push("version");
  fields.push(...validateSnapshotOrg(snapshot.consumer, "consumer"));
  fields.push(...validateSnapshotOrg(snapshot.provider, "provider"));
  if (snapshot.consumer.org_did === snapshot.provider.org_did)
    fields.push("provider.org_did");
  if (!isCapability(snapshot.capability)) fields.push("capability");
  if (!isEngagementState(snapshot.state)) fields.push("state");
  if (snapshot.ended_by !== undefined && !isEngagementParty(snapshot.ended_by))
    fields.push("ended_by");
  const proposed = Date.parse(snapshot.proposed_at);
  if (Number.isNaN(proposed)) fields.push("proposed_at");
  if (!(Date.parse(snapshot.expires_at) > proposed)) fields.push("expires_at");
  if (Date.parse(snapshot.updated_at) < proposed) fields.push("updated_at");
  return fields;
}

/**
 * Derives the engagement as the Org on `side` sees it: the other Org is the
 * counterparty.
 */
export function engagementView(
  snapshot: EngagementSnapshot,
  side: EngagementParty,
): Engagement {
  const other = side === "provider" ? snapshot.consumer : snapshot.provider;
  const view: Engagement = {
    id: snapshot.engagement_id,
    version: snapshot.version,
    counterparty: { domain: other.domain, display_name: other.display_name },
    capability: snapshot.capability,
    state: snapshot.state,
    proposed_at: snapshot.proposed_at,
    expires_at: snapshot.expires_at,
    updated_at: snapshot.updated_at,
  };
  if (snapshot.message !== undefined) view.message = snapshot.message;
  if (snapshot.consumer_reference !== undefined)
    view.consumer_reference = snapshot.consumer_reference;
  if (snapshot.provider_reference !== undefined)
    view.provider_reference = snapshot.provider_reference;
  if (snapshot.end_note !== undefined) view.end_note = snapshot.end_note;
  if (snapshot.ended_by !== undefined) view.ended_by = snapshot.ended_by;
  if (snapshot.decided_at !== undefined) view.decided_at = snapshot.decided_at;
  if (snapshot.ended_at !== undefined) view.ended_at = snapshot.ended_at;
  return view;
}

/**
 * What every provider command carries: the engagement and the version the
 * provider read, the provider Org that acts (the command's initiator), its
 * current display name, and the acting user's display name.
 */
export interface EngagementActorPayload {
  engagement_id: EngagementID;
  version: EngagementVersion;
  provider_org_did: OrgDID;
  provider_display_name: string;
  actor_display_name: string;
}

export function normalizeEngagementActorPayload<
  T extends EngagementActorPayload,
>(payload: T): T {
  return {
    ...payload,
    provider_display_name: payload.provider_display_name.trim(),
    actor_display_name: payload.actor_display_name.trim(),
  };
}

export function validateEngagementActorPayload(
  payload: EngagementActorPayload,
): string[] {
  const fields: string[] = [];
  if (!isEngagementID(payload.engagement_id)) fields.push("engagement_id");
  if (!Number.isInteger(payload.version) || payload.version < 1)
    fields.push("version");
  if (!isOrgDID(payload.provider_org_did)) fields.push("provider_org_did");
  for (const field of [
    "provider_display_name",
    "actor_display_name",
  ] as const) {
    const length = Array.from(payload[field]).length;
    if (length < 1 || length > 200) fields.push(field);
  }
  return fields;
}

/** Payload of `engagement-accept` and `engagement-decline`. */
export type EngagementDecisionPayload = EngagementActorPayload;

/** Payload of `engagement-end`. */
export interface EngagementEndPayload extends EngagementActorPayload {
  note?: string;
}

function validText(value: string, limit: number): boolean {
  const length = Array.from(value).length;
  return length >= 1 && length <= limit && isStorableText(value);
}

export function validateEngagementEndPayload(
  payload: EngagementEndPayload,
): string[] {
  const fields = validateEngagementActorPayload(payload);
  if (payload.note !== undefined && !validText(payload.note, maxEngagementNote))
    fields.push("note");
  return fields;
}

/** Payload of `engagement-set-reference`; an absent reference clears it. */
export interface EngagementReferencePayload extends EngagementActorPayload {
  reference?: string;
}

export function validateEngagementReferencePayload(
  payload: EngagementReferencePayload,
): string[] {
  const fields = validateEngagementActorPayload(payload);
  if (
    payload.reference !== undefined &&
    !validText(payload.reference, maxEngagementReference)
  )
    fields.push("reference");
  return fields;
}

/**
 * Provider work commands are sent by the provider's tenant to the client's
 * tenant, which is authoritative for the candidacy. Their authority principal
 * is the client Org, the initiator is the provider Org the payload names, and
 * their aggregate id is the work id.
 */
export const WorkScheduleInterviewKind: CommandKind = "work-schedule-interview";
export const WorkChangeInterviewKind: CommandKind = "work-change-interview";
export const WorkCancelInterviewKind: CommandKind = "work-cancel-interview";
export const WorkInterviewOutcomeKind: CommandKind =
  "work-record-interview-outcome";
export const WorkInterviewFeedbackKind: CommandKind =
  "work-submit-interview-feedback";
export const WorkAssessmentKind: CommandKind = "work-record-assessment";
export const WorkBackgroundCheckResultKind: CommandKind =
  "work-record-background-check-result";

/** What every provider work command carries. */
export interface WorkActor {
  engagement_id: EngagementID;
  work_id: WorkID;
  provider_org_did: OrgDID;
  actor_email: EmailAddress;
}

export function normalizeWorkActor<T extends WorkActor>(payload: T): T {
  return {
    ...payload,
    actor_email: normalizeEmailAddress(payload.actor_email),
  };
}

function actorFields(payload: WorkActor): string[] {
  const fields = validateWorkReference(payload);
  if (!isOrgDID(payload.provider_org_did)) fields.push("provider_org_did");
  if (!isEmailAddress(payload.actor_email)) fields.push("actor_email");
  return fields;
}

function merge(first: string[], second: string[]): string[] {
  return [...new Set([...first, ...second])];
}

export type WorkScheduleInterviewPayload = WorkActor & ScheduleInterviewRequest;
export type WorkChangeInterviewPayload = WorkActor & ChangeInterviewRequest;
export type WorkInterviewReferencePayload = WorkActor & InterviewReference;
export type WorkInterviewOutcomePayload = WorkActor &
  RecordInterviewOutcomeRequest;
export type WorkInterviewFeedbackPayload = WorkActor &
  SubmitInterviewFeedbackRequest;
export type WorkAssessmentPayload = WorkActor & RecordAssessmentRequest;
export type WorkBackgroundCheckResultPayload = WorkActor &
  RecordBackgroundCheckResultRequest;

export function normalizeWorkScheduleInterviewPayload(
  payload: WorkScheduleInterviewPayload,
): WorkScheduleInterviewPayload {
  return normalizeWorkActor(normalizeScheduleInterviewRequest(payload));
}

export function validateWorkScheduleInterviewPayload(
  payload: WorkScheduleInterviewPayload,
): string[] {
  return merge(actorFields(payload), validateScheduleInterviewRequest(payload));
}

export function normalizeWorkChangeInterviewPayload(
  payload: WorkChangeInterviewPayload,
): WorkChangeInterviewPayload {
  return normalizeWorkActor(normalizeChangeInterviewRequest(payload));
}

export function validateWorkChangeInterviewPayload(
  payload: WorkChangeInterviewPayload,
): string[] {
  return merge(actorFields(payload), validateChangeInterviewRequest(payload));
}

export function validateWorkInterviewReferencePayload(
  payload: WorkInterviewReferencePayload,
): string[] {
  return merge(actorFields(payload), validateInterviewReference(payload));
}

export function validateWorkInterviewOutcomePayload(
  payload: WorkInterviewOutcomePayload,
): string[] {
  return merge(
    actorFields(payload),
    validateRecordInterviewOutcomeRequest(payload),
  );
}

export function normalizeWorkInterviewFeedbackPayload(
  payload: WorkInterviewFeedbackPayload,
): WorkInterviewFeedbackPayload {
  return normalizeWorkActor(normalizeSubmitInterviewFeedbackRequest(payload));
}

export function validateWorkInterviewFeedbackPayload(
  payload: WorkInterviewFeedbackPayload,
): string[] {
  return merge(
    actorFields(payload),
    validateSubmitInterviewFeedbackRequest(payload),
  );
}

export function normalizeWorkAssessmentPayload(
  payload: WorkAssessmentPayload,
): WorkAssessmentPayload {
  return normalizeWorkActor(normalizeRecordAssessmentRequest(payload));
}

export function validateWorkAssessmentPayload(
  payload: WorkAssessmentPayload,
): string[] {
  return merge(actorFields(payload), validateRecordAssessmentRequest(payload));
}

export function normalizeWorkBackgroundCheckResultPayload(
  payload: WorkBackgroundCheckResultPayload,
): WorkBackgroundCheckResultPayload {
  return normalizeWorkActor(
    normalizeRecordBackgroundCheckResultRequest(payload),
  );
}

export function validateWorkBackgroundCheckResultPayload(
  payload: WorkBackgroundCheckResultPayload,
): string[] {
  return merge(
    actorFields(payload),
    validateRecordBackgroundCheckResultRequest(payload),
  );
}
