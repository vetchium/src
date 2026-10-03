export interface SetGoogleSignInRequest {
  enabled: boolean;
}

export function validateSetGoogleSignInRequest(
  _request: SetGoogleSignInRequest,
): string[] {
  return [];
}
