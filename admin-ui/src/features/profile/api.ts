import type {
  MyInfoResponse,
  SetDisplayNameRequest,
  SetPreferredLanguageRequest,
} from "../../../../typespec/admin/users/profile.ts";
import { requestJson, requestVoid } from "../../api/client";

export function getMyInfo(): Promise<MyInfoResponse> {
  return requestJson("/admin/my-info", { method: "GET" });
}

export function setDisplayName(request: SetDisplayNameRequest): Promise<void> {
  return requestVoid("/admin/set-display-name", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function setPreferredLanguage(
  request: SetPreferredLanguageRequest,
): Promise<void> {
  return requestVoid("/admin/set-preferred-language", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
