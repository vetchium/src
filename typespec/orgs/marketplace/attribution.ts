import type { DisplayName } from "../../common/localization.ts";
import type { PaginationKey } from "../../common/pagination.ts";
import { isPaginationKey } from "../../common/pagination.ts";
import type { PrincipalDID, TenantID } from "../../directory/directory.ts";
import {
  type ApplicationStatus,
  isApplicationStatus,
} from "../../hub/applications/applications.ts";
import type { ApplicationNumber } from "../applications/applications.ts";
import type { OpeningNumber } from "../openings/types.ts";
import { isOrgDomain, normalizeOrgDomain, type OrgDomain } from "../types.ts";
import { type ContactID, isContactID } from "./contacts/contacts.ts";
import type { EngagementCounterparty, EngagementID } from "./engagements.ts";
import {
  isWorkPageSize,
  type WorkOpening,
  type WorkPageSize,
} from "./work/work.ts";

export type ReferralRoute = "suggested" | "declared";

export function isReferralRoute(value: unknown): value is ReferralRoute {
  return value === "suggested" || value === "declared";
}

export interface CreditedAgency {
  engagement_id: EngagementID;
  domain: OrgDomain;
  display_name: DisplayName;
}

export interface CreditedApplicationSummary {
  engagement_id: EngagementID;
  client: EngagementCounterparty;
  opening: WorkOpening;
  application_number: ApplicationNumber;
  route: ReferralRoute;
  status: ApplicationStatus;
  contact_id?: ContactID;
  applicant_did?: PrincipalDID;
  applied_at: string;
}

export interface ListCreditedApplicationsRequest {
  client_domain?: OrgDomain;
  opening_number?: OpeningNumber;
  route?: ReferralRoute;
  status?: ApplicationStatus;
  contact_id?: ContactID;
  pagination_key?: PaginationKey;
  limit?: WorkPageSize;
}

export function normalizeListCreditedApplicationsRequest(
  request: ListCreditedApplicationsRequest,
): ListCreditedApplicationsRequest {
  if (request.client_domain !== undefined) {
    return {
      ...request,
      client_domain: normalizeOrgDomain(request.client_domain),
    };
  }
  return request;
}

export function effectiveListCreditedApplicationsLimit(
  request: ListCreditedApplicationsRequest,
): WorkPageSize {
  return request.limit ?? 50;
}

export function validateListCreditedApplicationsRequest(
  request: ListCreditedApplicationsRequest,
): string[] {
  const fields: string[] = [];
  if (
    request.client_domain !== undefined &&
    !isOrgDomain(request.client_domain)
  ) {
    fields.push("client_domain");
  }
  if (
    request.opening_number !== undefined &&
    (!Number.isInteger(request.opening_number) || request.opening_number < 1)
  ) {
    fields.push("opening_number");
  }
  if (request.route !== undefined && !isReferralRoute(request.route)) {
    fields.push("route");
  }
  if (request.status !== undefined && !isApplicationStatus(request.status)) {
    fields.push("status");
  }
  if (request.contact_id !== undefined && !isContactID(request.contact_id)) {
    fields.push("contact_id");
  }
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  ) {
    fields.push("pagination_key");
  }
  if (request.limit !== undefined && !isWorkPageSize(request.limit)) {
    fields.push("limit");
  }
  return fields;
}

export interface ListCreditedApplicationsResponse {
  items: CreditedApplicationSummary[];
  unavailable_tenants: TenantID[];
  next_pagination_key?: PaginationKey;
}
