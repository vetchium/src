import type { PaginationKey } from "../../common/pagination.ts";
import { isPaginationKey } from "../../common/pagination.ts";
import type { OrgDomain } from "../types.ts";
import { isOrgDomain, normalizeOrgDomain } from "../types.ts";
import type { Capability } from "./capabilities.ts";
import { isCapability } from "./capabilities.ts";
import { isStorableText } from "./listings.ts";

export const maxEngagementMessage = 2000;
export const maxEngagementNote = 2000;
export const maxEngagementReference = 200;
/** Bounds one page of engagements. */
export const maxEngagementPage = 100;
/** How long a proposal waits for the provider before it expires. */
export const proposalLifetimeMilliseconds = 30 * 24 * 60 * 60 * 1000;

export type EngagementID = string;
export type EngagementVersion = number;

export const engagementStateValues = [
  "proposed",
  "active",
  "declined",
  "withdrawn",
  "expired",
  "ended",
] as const;
export type EngagementState = (typeof engagementStateValues)[number];

export const ProposedEngagement: EngagementState = "proposed";
export const ActiveEngagement: EngagementState = "active";
export const DeclinedEngagement: EngagementState = "declined";
export const WithdrawnEngagement: EngagementState = "withdrawn";
export const ExpiredEngagement: EngagementState = "expired";
export const EndedEngagement: EngagementState = "ended";

const engagementStates = new Set<string>(engagementStateValues);

export function isEngagementState(value: unknown): value is EngagementState {
  return typeof value === "string" && engagementStates.has(value);
}

/**
 * Reports a state no action leaves: the engagement stays readable to both
 * sides, and a new proposal creates a new engagement.
 */
export function isTerminalEngagementState(value: unknown): boolean {
  return value !== "proposed" && value !== "active";
}

export type EngagementParty = "consumer" | "provider";

export const ConsumerParty: EngagementParty = "consumer";
export const ProviderParty: EngagementParty = "provider";

export function isEngagementParty(value: unknown): value is EngagementParty {
  return value === "consumer" || value === "provider";
}

const engagementIDPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Accepts the lowercase form the API returns. */
export function isEngagementID(value: string): boolean {
  return engagementIDPattern.test(value);
}

function validVersion(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 1;
}

function validOptionalText(value: string | undefined, limit: number): boolean {
  if (value === undefined) return true;
  const length = Array.from(value).length;
  return length >= 1 && length <= limit && isStorableText(value);
}

function trimOptional(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.trim();
}

/** The other Org of an engagement, as the viewer sees it. */
export interface EngagementCounterparty {
  domain: OrgDomain;
  display_name: string;
}

/**
 * An engagement as one of its two Orgs sees it: the counterparty is the
 * provider for the consumer and the client for the provider. Both sides see
 * both references.
 */
export interface Engagement {
  id: EngagementID;
  version: EngagementVersion;
  counterparty: EngagementCounterparty;
  capability: Capability;
  state: EngagementState;
  message?: string;
  consumer_reference?: string;
  provider_reference?: string;
  end_note?: string;
  ended_by?: EngagementParty;
  proposed_at: string;
  /** When a `proposed` engagement expires. */
  expires_at: string;
  decided_at?: string;
  ended_at?: string;
  updated_at: string;
}

export interface ProposeEngagementRequest {
  provider_domain: OrgDomain;
  capability: Capability;
  message?: string;
}

export function normalizeProposeEngagementRequest(
  request: ProposeEngagementRequest,
): ProposeEngagementRequest {
  const normalized: ProposeEngagementRequest = {
    provider_domain: normalizeOrgDomain(request.provider_domain),
    capability: request.capability,
  };
  const message = trimOptional(request.message);
  if (message !== undefined) normalized.message = message;
  return normalized;
}

export function validateProposeEngagementRequest(
  request: ProposeEngagementRequest,
): string[] {
  const fields: string[] = [];
  if (!isOrgDomain(request.provider_domain)) fields.push("provider_domain");
  if (!isCapability(request.capability)) fields.push("capability");
  if (!validOptionalText(request.message, maxEngagementMessage))
    fields.push("message");
  return fields;
}

/** Names an engagement and the version the caller read. */
export interface EngagementTarget {
  engagement_id: EngagementID;
  version: EngagementVersion;
}

export function validateEngagementTarget(request: EngagementTarget): string[] {
  const fields: string[] = [];
  if (!isEngagementID(request.engagement_id)) fields.push("engagement_id");
  if (!validVersion(request.version)) fields.push("version");
  return fields;
}

export interface EndEngagementRequest extends EngagementTarget {
  note?: string;
}

export function normalizeEndEngagementRequest(
  request: EndEngagementRequest,
): EndEngagementRequest {
  const normalized: EndEngagementRequest = {
    engagement_id: request.engagement_id,
    version: request.version,
  };
  const note = trimOptional(request.note);
  if (note !== undefined) normalized.note = note;
  return normalized;
}

export function validateEndEngagementRequest(
  request: EndEngagementRequest,
): string[] {
  const fields = validateEngagementTarget(request);
  if (!validOptionalText(request.note, maxEngagementNote)) fields.push("note");
  return fields;
}

/** An absent `reference` clears the caller's own reference. */
export interface SetEngagementReferenceRequest extends EngagementTarget {
  reference?: string;
}

export function normalizeSetEngagementReferenceRequest(
  request: SetEngagementReferenceRequest,
): SetEngagementReferenceRequest {
  const normalized: SetEngagementReferenceRequest = {
    engagement_id: request.engagement_id,
    version: request.version,
  };
  const reference = trimOptional(request.reference);
  if (reference !== undefined) normalized.reference = reference;
  return normalized;
}

export function validateSetEngagementReferenceRequest(
  request: SetEngagementReferenceRequest,
): string[] {
  const fields = validateEngagementTarget(request);
  if (!validOptionalText(request.reference, maxEngagementReference))
    fields.push("reference");
  return fields;
}

export interface GetEngagementRequest {
  engagement_id: EngagementID;
}

export function validateGetEngagementRequest(
  request: GetEngagementRequest,
): string[] {
  return isEngagementID(request.engagement_id) ? [] : ["engagement_id"];
}

export interface ListEngagementsRequest {
  state?: EngagementState;
  capability?: Capability;
  pagination_key?: PaginationKey;
  /** Defaults to 50. */
  limit?: number;
}

export function validateListEngagementsRequest(
  request: ListEngagementsRequest,
): string[] {
  const fields: string[] = [];
  if (request.state !== undefined && !isEngagementState(request.state))
    fields.push("state");
  if (request.capability !== undefined && !isCapability(request.capability))
    fields.push("capability");
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  )
    fields.push("pagination_key");
  if (
    request.limit !== undefined &&
    (!Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > maxEngagementPage)
  )
    fields.push("limit");
  return fields;
}

export interface ListEngagementsResponse {
  engagements: Engagement[];
  next_pagination_key?: PaginationKey;
}
