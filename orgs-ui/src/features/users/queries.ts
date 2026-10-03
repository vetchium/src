import { useQuery } from "@tanstack/react-query";
import type { ListInvitationsRequest } from "typespec/orgs/users/invitations";
import type { ListUsersRequest } from "typespec/orgs/users/management";
import { orgsAPI } from "../../api/orgs";

export const usersQueryKey = ["orgs", "users"] as const;
export const userSummaryQueryKey = ["orgs", "user-summary"] as const;
export const invitationsQueryKey = ["orgs", "invitations"] as const;

export function useUsersQuery(request: ListUsersRequest) {
  return useQuery({
    queryKey: [...usersQueryKey, request],
    queryFn: () => orgsAPI.listUsers(request),
    placeholderData: (previous) => previous,
  });
}

export function useUserSummaryQuery() {
  return useQuery({
    queryKey: userSummaryQueryKey,
    queryFn: orgsAPI.userSummary,
  });
}

export function useInvitationsQuery(request: ListInvitationsRequest) {
  return useQuery({
    queryKey: [...invitationsQueryKey, request],
    queryFn: () => orgsAPI.listInvitations(request),
    placeholderData: (previous) => previous,
  });
}
