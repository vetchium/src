import { getApiBaseUrl } from "../config";
import type {
  Region,
  SupportedLanguage,
  CheckDomainRequest,
  CheckDomainResponse,
  RequestSignupRequest,
  RequestSignupResponse,
  CompleteSignupRequest,
  CompleteSignupResponse,
  HubLoginRequest,
  HubLoginResponse,
  ValidationError,
  GetRegionsResponse,
  GetSupportedLanguagesResponse,
} from "vetchium-specs/hub/hub-users";

export interface APIResponse<T> {
  status: number;
  data?: T;
  errors?: ValidationError[];
}

/**
 * Get list of active regions
 */
export async function getRegions(): Promise<APIResponse<Region[]>> {
  const apiBaseUrl = await getApiBaseUrl();
  const response = await fetch(`${apiBaseUrl}/hub/get-regions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const status = response.status;
  if (status === 200) {
    const responseData: GetRegionsResponse = await response.json();
    return { status, data: responseData.regions };
  }

  return { status };
}

/**
 * Get list of supported languages
 */
export async function getSupportedLanguages(): Promise<
  APIResponse<SupportedLanguage[]>
> {
  const apiBaseUrl = await getApiBaseUrl();
  const response = await fetch(`${apiBaseUrl}/hub/get-supported-languages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const status = response.status;
  if (status === 200) {
    const responseData: GetSupportedLanguagesResponse = await response.json();
    return { status, data: responseData.languages };
  }

  return { status };
}

/**
 * Check if a domain is approved for signup
 */
export async function checkDomain(
  domain: string,
): Promise<APIResponse<CheckDomainResponse>> {
  const apiBaseUrl = await getApiBaseUrl();
  const requestBody: CheckDomainRequest = { domain };

  const response = await fetch(`${apiBaseUrl}/hub/check-domain`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const status = response.status;
  if (status === 200) {
    const data = await response.json();
    return { status, data };
  }

  if (status === 400) {
    const errors = await response.json();
    return { status, errors };
  }

  return { status };
}

/**
 * Request signup verification email
 */
export async function requestSignup(
  email: string,
): Promise<APIResponse<RequestSignupResponse>> {
  const apiBaseUrl = await getApiBaseUrl();
  const requestBody: RequestSignupRequest = { email_address: email };

  const response = await fetch(`${apiBaseUrl}/hub/request-signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const status = response.status;
  if (status === 200) {
    const data = await response.json();
    return { status, data };
  }

  if (status === 400) {
    const errors = await response.json();
    return { status, errors };
  }

  return { status };
}

/**
 * Complete signup with verification token
 */
export async function completeSignup(
  request: CompleteSignupRequest,
): Promise<APIResponse<CompleteSignupResponse>> {
  const apiBaseUrl = await getApiBaseUrl();

  const response = await fetch(`${apiBaseUrl}/hub/complete-signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  const status = response.status;
  if (status === 201) {
    const data = await response.json();
    return { status, data };
  }

  if (status === 400) {
    const errors = await response.json();
    return { status, errors };
  }

  return { status };
}

/**
 * Login with email and password
 */
export async function login(
  email: string,
  password: string,
): Promise<APIResponse<HubLoginResponse>> {
  const apiBaseUrl = await getApiBaseUrl();
  const requestBody: HubLoginRequest = {
    email_address: email,
    password,
  };

  const response = await fetch(`${apiBaseUrl}/hub/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const status = response.status;
  if (status === 200) {
    const data = await response.json();
    return { status, data };
  }

  if (status === 400) {
    const errors = await response.json();
    return { status, errors };
  }

  return { status };
}

/**
 * Logout with session token
 */
export async function logout(sessionToken: string): Promise<APIResponse<void>> {
  const apiBaseUrl = await getApiBaseUrl();

  const response = await fetch(`${apiBaseUrl}/hub/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
  });

  return { status: response.status };
}
