import { useQuery } from "@tanstack/react-query";
import type { ListUsersRequest } from "typespec/admin/users/management";
import { listUsers } from "./api";

export const usersQueryKey = ["admin", "users"] as const;

export function useUsersQuery(request: ListUsersRequest) {
  return useQuery({
    queryKey: [...usersQueryKey, request],
    queryFn: () => listUsers(request),
    placeholderData: (previous) => previous,
  });
}
