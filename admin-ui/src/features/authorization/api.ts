import type { SetPermissionsRequest } from "typespec/admin/authorization/management";
import { requestVoid } from "../../api/client";

export function setPermissions(request: SetPermissionsRequest): Promise<void> {
  return requestVoid("/admin/set-user-permissions", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
