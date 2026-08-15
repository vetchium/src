import type {
  InviteUserRequest,
  InviteUserResponse,
} from "../../../../typespec/admin/users/invitations.ts";
import type {
  DisableUserRequest,
  EnableUserRequest,
  ListUsersRequest,
  ListUsersResponse,
} from "../../../../typespec/admin/users/management.ts";
import type { IdempotencyKey } from "../../../../typespec/common/idempotency.ts";
import { idempotencyHeaders, requestJson, requestVoid } from "../../api/client";

export function listUsers(
  request: ListUsersRequest,
): Promise<ListUsersResponse> {
  return requestJson("/admin/list-users", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function inviteUser(
  request: InviteUserRequest,
  idempotencyKey: IdempotencyKey,
): Promise<InviteUserResponse> {
  return requestJson("/admin/invite-user", {
    method: "POST",
    headers: idempotencyHeaders(idempotencyKey),
    body: JSON.stringify(request),
  });
}

export function disableUser(request: DisableUserRequest): Promise<void> {
  return requestVoid("/admin/disable-user", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function enableUser(request: EnableUserRequest): Promise<void> {
  return requestVoid("/admin/enable-user", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
