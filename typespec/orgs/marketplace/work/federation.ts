import type { TenantID } from "../../../directory/directory.ts";
import { isTenantID } from "../../../directory/directory.ts";
import type { OpeningNumber, OpeningState } from "../../openings/types.ts";
import { openingStates } from "../../openings/types.ts";

function isOpeningState(value: unknown): value is OpeningState {
  return openingStates.includes(value as OpeningState);
}

import type { OrgDID, OrgDomain } from "../../types.ts";
import { isOrgDID, isOrgDomain, normalizeOrgDomain } from "../../types.ts";
import type { Capability } from "../capabilities.ts";
import type { EngagementID } from "../engagements.ts";
import type {
  Job,
  JobDetail,
  WorkDetail,
  WorkID,
  WorkItem,
  WorkStatus,
} from "./work.ts";
import {
  isWorkID,
  maxPage,
  normalizeListWorkQueueRequest,
  validateJobReference,
  validateListWorkQueueRequest,
  validateWorkReference,
} from "./work.ts";

/**
 * Where the next page of the merged work queue resumes. Each tenant orders
 * by `bucket` (0: an upcoming interview, 1: the rest), then `sort`, then the
 * work id.
 */
export interface Position {
  bucket: number;
  sort: number;
  work_id: WorkID;
}

export function isPosition(value: Position): boolean {
  return (
    (value.bucket === 0 || value.bucket === 1) &&
    Number.isSafeInteger(value.sort) &&
    isWorkID(value.work_id)
  );
}

function validLimit(limit: number): boolean {
  return Number.isInteger(limit) && limit >= 1 && limit <= maxPage;
}

/** One client tenant's share of a provider's work queue. */
export interface PeerListWorkRequest {
  provider_org_did: OrgDID;
  client_domain?: OrgDomain;
  capability?: Capability;
  opening_number?: OpeningNumber;
  stage_name?: string;
  status?: WorkStatus;
  after?: Position;
  limit: number;
}

export function normalizePeerListWorkRequest(
  request: PeerListWorkRequest,
): PeerListWorkRequest {
  return { ...request, ...normalizeListWorkQueueRequest(request) };
}

export function validatePeerListWorkRequest(
  request: PeerListWorkRequest,
): string[] {
  const fields: string[] = [];
  if (!isOrgDID(request.provider_org_did)) fields.push("provider_org_did");
  fields.push(
    ...validateListWorkQueueRequest({
      client_domain: request.client_domain,
      capability: request.capability,
      opening_number: request.opening_number,
      stage_name: request.stage_name,
      status: request.status,
    } as never),
  );
  if (request.after !== undefined && !isPosition(request.after))
    fields.push("after");
  if (!validLimit(request.limit)) fields.push("limit");
  return fields;
}

export interface PeerWorkEntry {
  position: Position;
  item: WorkItem;
}

export interface PeerListWorkResponse {
  items: PeerWorkEntry[];
  has_more: boolean;
}

export interface PeerGetWorkRequest {
  provider_org_did: OrgDID;
  engagement_id: EngagementID;
  work_id: WorkID;
}

export function validatePeerGetWorkRequest(
  request: PeerGetWorkRequest,
): string[] {
  const fields: string[] = [];
  if (!isOrgDID(request.provider_org_did)) fields.push("provider_org_did");
  return [...fields, ...validateWorkReference(request)];
}

/** Where the next page of the merged jobs resumes. */
export interface JobPosition {
  assigned_at: string;
  assignment_id: WorkID;
}

export function isJobPosition(value: JobPosition): boolean {
  return (
    !Number.isNaN(Date.parse(value.assigned_at)) &&
    isWorkID(value.assignment_id)
  );
}

export interface PeerListJobsRequest {
  provider_org_did: OrgDID;
  client_domain?: OrgDomain;
  state: OpeningState;
  after?: JobPosition;
  limit: number;
}

export function normalizePeerListJobsRequest(
  request: PeerListJobsRequest,
): PeerListJobsRequest {
  const normalized = { ...request };
  if (request.client_domain !== undefined)
    normalized.client_domain = normalizeOrgDomain(request.client_domain);
  return normalized;
}

export function validatePeerListJobsRequest(
  request: PeerListJobsRequest,
): string[] {
  const fields: string[] = [];
  if (!isOrgDID(request.provider_org_did)) fields.push("provider_org_did");
  if (
    request.client_domain !== undefined &&
    !isOrgDomain(request.client_domain)
  )
    fields.push("client_domain");
  if (!isOpeningState(request.state)) fields.push("state");
  if (request.after !== undefined && !isJobPosition(request.after))
    fields.push("after");
  if (!validLimit(request.limit)) fields.push("limit");
  return fields;
}

export interface PeerJobEntry {
  position: JobPosition;
  job: Job;
}

export interface PeerListJobsResponse {
  jobs: PeerJobEntry[];
  has_more: boolean;
}

export interface PeerGetJobRequest {
  provider_org_did: OrgDID;
  engagement_id: EngagementID;
  opening_number: OpeningNumber;
}

export function validatePeerGetJobRequest(
  request: PeerGetJobRequest,
): string[] {
  const fields: string[] = [];
  if (!isOrgDID(request.provider_org_did)) fields.push("provider_org_did");
  return [...fields, ...validateJobReference(request)];
}

function relayFields(tenant: TenantID, inner: string[]): string[] {
  const fields: string[] = [];
  if (!isTenantID(tenant)) fields.push("tenant");
  for (const field of inner) fields.push(`request.${field}`);
  return fields;
}

export interface RelayListWorkRequest {
  tenant: TenantID;
  request: PeerListWorkRequest;
}

export function validateRelayListWorkRequest(
  request: RelayListWorkRequest,
): string[] {
  return relayFields(
    request.tenant,
    validatePeerListWorkRequest(request.request),
  );
}

export interface RelayGetWorkRequest {
  tenant: TenantID;
  request: PeerGetWorkRequest;
}

export function validateRelayGetWorkRequest(
  request: RelayGetWorkRequest,
): string[] {
  return relayFields(
    request.tenant,
    validatePeerGetWorkRequest(request.request),
  );
}

export interface RelayListJobsRequest {
  tenant: TenantID;
  request: PeerListJobsRequest;
}

export function validateRelayListJobsRequest(
  request: RelayListJobsRequest,
): string[] {
  return relayFields(
    request.tenant,
    validatePeerListJobsRequest(request.request),
  );
}

export interface RelayGetJobRequest {
  tenant: TenantID;
  request: PeerGetJobRequest;
}

export function validateRelayGetJobRequest(
  request: RelayGetJobRequest,
): string[] {
  return relayFields(
    request.tenant,
    validatePeerGetJobRequest(request.request),
  );
}

export type { JobDetail, WorkDetail };
