export interface SetGoogleSignInRequest {
  enabled: boolean;
}

export function validateSetGoogleSignInRequest(
  request: SetGoogleSignInRequest,
): string[] {
  return typeof request.enabled === "boolean" ? [] : ["enabled"];
}
