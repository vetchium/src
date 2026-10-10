import type { EmailAddress } from "../../common/common";
import type { PageSize, PaginationKey } from "../../common/pagination";
import type { HubHandle } from "../../hub/types";
import type { DomainName } from "../hub-signup-domains/domains";

export interface ListRequest {
  start_at: string;
  end_at: string;
  hub_handle?: HubHandle;
  hub_email?: EmailAddress;
  org_domain?: DomainName;
  org_user_email?: EmailAddress;
  limit?: PageSize;
  pagination_key?: PaginationKey;
}
export interface Detail {
  field: string;
  value: string;
}
export interface Event {
  audit_event_id: string;
  created_at: string;
  action: string;
  entity_type: string;
  actor_type: string;
  actor_name?: string;
  source: string;
  details: Detail[];
}
export interface ListResponse {
  events: Event[];
  next_pagination_key?: PaginationKey;
}

export function validDateRange(start: string, end: string): boolean {
  const from = Date.parse(start);
  const to = Date.parse(end);
  return (
    Number.isFinite(from) &&
    Number.isFinite(to) &&
    to >= from &&
    to - from <= 31 * 24 * 60 * 60 * 1000
  );
}
