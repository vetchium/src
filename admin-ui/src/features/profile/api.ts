import type {
  MyInfoResponse,
  SetDisplayNamesRequest,
  SetPreferredLanguageRequest,
} from "../../../../typespec/admin/users/profile.ts";
import { requestJson, requestVoid } from "../../api/client";

export function getMyInfo(): Promise<MyInfoResponse> {
  return requestJson("/admin/my-info", { method: "GET" });
}

export function setDisplayNames(
  request: SetDisplayNamesRequest,
): Promise<void> {
  return requestVoid("/admin/set-display-names", {
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
