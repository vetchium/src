import {
  type DisplayName,
  isDisplayName,
  normalizeDisplayName,
} from "../../common/localization.ts";
export interface SetCompanyNameRequest {
  display_name: DisplayName;
}
export function normalizeSetCompanyNameRequest(
  request: SetCompanyNameRequest,
): SetCompanyNameRequest {
  return {
    ...request,
    display_name: normalizeDisplayName(request.display_name),
  };
}
export function validateSetCompanyNameRequest(
  request: SetCompanyNameRequest,
): string[] {
  return isDisplayName(request.display_name) ? [] : ["display_name"];
}
