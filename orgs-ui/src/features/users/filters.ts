import {
  ManageBilling,
  ManageUsers,
  Superadmin,
} from "typespec/orgs/authorization/types";
import type {
  ListUsersRequest,
  UserSort,
  UserStateFilter,
} from "typespec/orgs/users/management";
import type { RolePreset } from "./roles";

export interface MemberFilters {
  /** At least two characters, or empty for no search. */
  search: string;
  state?: UserStateFilter;
  role?: RolePreset;
  sort: UserSort;
  descending: boolean;
}

export const defaultFilters: MemberFilters = {
  search: "",
  sort: "email",
  descending: false,
};

/** The list request for these filters, without a page size or key. */
export function filtersToRequest(filters: MemberFilters): ListUsersRequest {
  const request: ListUsersRequest = {
    sort_by: filters.sort,
    sort_descending: filters.descending,
  };
  if (filters.search.length >= 2) request.filter_search = filters.search;
  if (filters.state !== undefined) request.filter_state = filters.state;
  switch (filters.role) {
    case "superadmin":
      request.filter_permission = Superadmin;
      break;
    case "finance":
      request.filter_permission = ManageBilling;
      break;
    case "userManager":
      request.filter_permission = ManageUsers;
      break;
    case "member":
      request.filter_no_permissions = true;
      break;
  }
  return request;
}

export function hasFilters(filters: MemberFilters): boolean {
  return (
    filters.search !== "" ||
    filters.state !== undefined ||
    filters.role !== undefined
  );
}
