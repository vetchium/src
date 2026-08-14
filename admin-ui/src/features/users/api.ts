import type {
  ListUsersRequest,
  ListUsersResponse,
} from "../../../../typespec/admin/users/management.ts";
import { requestJson } from "../../api/client";

export function listUsers(
  request: ListUsersRequest,
): Promise<ListUsersResponse> {
  return requestJson("/admin/list-users", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
