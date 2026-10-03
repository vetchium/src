import { isOpaqueToken } from "../../common/authentication.ts";
import { isOrgDomain, normalizeOrgDomain, type OrgDomain } from "../types.ts";

export type OrgSSOState = string;

/** Bounds the authorization code a provider may return. */
export const maxSSOCodeLength = 4096;

export interface StartGoogleSignInRequest {
  domain: OrgDomain;
}

export function normalizeStartGoogleSignInRequest(
  request: StartGoogleSignInRequest,
): StartGoogleSignInRequest {
  return { ...request, domain: normalizeOrgDomain(request.domain) };
}

export function validateStartGoogleSignInRequest(
  request: StartGoogleSignInRequest,
): string[] {
  return isOrgDomain(normalizeOrgDomain(request.domain)) ? [] : ["domain"];
}

export interface StartGoogleSignInResponse {
  authorization_url: string;
}

export interface CompleteGoogleSignInRequest {
  state: OrgSSOState;
  code: string;
}

export function validateCompleteGoogleSignInRequest(
  request: CompleteGoogleSignInRequest,
): string[] {
  const fields: string[] = [];
  if (!isOpaqueToken(request.state)) fields.push("state");
  const length = [...request.code].length;
  if (length < 1 || length > maxSSOCodeLength) fields.push("code");
  return fields;
}
