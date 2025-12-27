import { APIRequestContext } from "@playwright/test";
import {
  AdminLoginRequest,
  AdminLoginResponse,
  AdminTFARequest,
  AdminTFAResponse,
  AdminLogoutRequest,
} from "../../specs/typespec/admin/admin-users";
import type {
  AddApprovedDomainRequest,
  ListApprovedDomainsRequest,
  GetApprovedDomainRequest,
  DisableApprovedDomainRequest,
  EnableApprovedDomainRequest,
  ApprovedDomainListResponse,
  ApprovedDomainDetailResponse,
} from "../../specs/typespec/admin/approved-domains";

/**
 * Generic API response wrapper for test assertions.
 */
export interface APIResponse<T> {
  status: number;
  body: T;
  errors?: string[];
}

// ============================================================================
// Admin API Client
// ============================================================================

/**
 * Admin API client for testing admin authentication endpoints.
 * Wraps Playwright's request context for type-safe API calls.
 */
export class AdminAPIClient {
  constructor(private request: APIRequestContext) {}

  /**
   * POST /admin/login
   * Initiates admin login with email and password.
   * On success, returns a TFA token and sends TFA code via email.
   *
   * @param request - Login request with email and password
   * @returns API response with TFA token on success
   */
  async login(request: AdminLoginRequest): Promise<APIResponse<AdminLoginResponse>> {
    const response = await this.request.post("/admin/login", {
      data: request,
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: body as AdminLoginResponse,
      errors: body.errors,
    };
  }

  /**
   * POST /admin/login with raw body for testing invalid payloads
   */
  async loginRaw(body: unknown): Promise<APIResponse<AdminLoginResponse>> {
    const response = await this.request.post("/admin/login", {
      data: body,
    });

    const responseBody = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: responseBody as AdminLoginResponse,
      errors: responseBody.errors,
    };
  }

  /**
   * POST /admin/tfa
   * Verifies TFA code and returns session token on success.
   *
   * @param request - TFA request with tfa_token and tfa_code
   * @returns API response with session token on success
   */
  async verifyTFA(request: AdminTFARequest): Promise<APIResponse<AdminTFAResponse>> {
    const response = await this.request.post("/admin/tfa", {
      data: request,
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: body as AdminTFAResponse,
      errors: body.errors,
    };
  }

  /**
   * POST /admin/tfa with raw body for testing invalid payloads
   */
  async verifyTFARaw(body: unknown): Promise<APIResponse<AdminTFAResponse>> {
    const response = await this.request.post("/admin/tfa", {
      data: body,
    });

    const responseBody = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: responseBody as AdminTFAResponse,
      errors: responseBody.errors,
    };
  }

  /**
   * POST /admin/logout
   * Invalidates the session token.
   *
   * @param request - Logout request with session_token
   * @returns API response (empty body on success)
   */
  async logout(request: AdminLogoutRequest): Promise<APIResponse<void>> {
    const response = await this.request.post("/admin/logout", {
      data: request,
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: undefined,
      errors: body.errors,
    };
  }

  /**
   * POST /admin/logout with raw body for testing invalid payloads
   */
  async logoutRaw(body: unknown): Promise<APIResponse<void>> {
    const response = await this.request.post("/admin/logout", {
      data: body,
    });

    const responseBody = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: undefined,
      errors: responseBody.errors,
    };
  }

  // ============================================================================
  // Approved Domains API
  // ============================================================================

  /**
   * POST /admin/add-approved-domain
   * Creates a new approved domain.
   *
   * @param sessionToken - Session token for authentication
   * @param request - Domain creation request with domain_name and reason
   * @returns API response with created domain on success (201)
   */
  async createApprovedDomain(
    sessionToken: string,
    request: AddApprovedDomainRequest
  ): Promise<APIResponse<ApprovedDomainDetailResponse["domain"]>> {
    const response = await this.request.post("/admin/add-approved-domain", {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: request,
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: body as ApprovedDomainDetailResponse["domain"],
      errors: body.errors,
    };
  }

  /**
   * POST /admin/add-approved-domain with raw body for testing invalid payloads
   */
  async createApprovedDomainRaw(
    sessionToken: string,
    body: unknown
  ): Promise<APIResponse<ApprovedDomainDetailResponse["domain"]>> {
    const response = await this.request.post("/admin/add-approved-domain", {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: body,
    });

    const responseBody = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: responseBody as ApprovedDomainDetailResponse["domain"],
      errors: responseBody.errors,
    };
  }

  /**
   * POST /admin/list-approved-domains
   * Lists approved domains with optional filtering and search.
   *
   * @param sessionToken - Session token for authentication
   * @param request - Optional list request with limit, cursor, search, filter
   * @returns API response with list of domains
   */
  async listApprovedDomains(
    sessionToken: string,
    request?: ListApprovedDomainsRequest
  ): Promise<APIResponse<ApprovedDomainListResponse>> {
    const response = await this.request.post("/admin/list-approved-domains", {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: request ? { ...request, filter: request.filter || "active" } : { filter: "active" },
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: body as ApprovedDomainListResponse,
      errors: body.errors,
    };
  }

  /**
   * POST /admin/list-approved-domains with raw body for testing invalid payloads
   */
  async listApprovedDomainsRaw(
    sessionToken: string,
    body: unknown
  ): Promise<APIResponse<ApprovedDomainListResponse>> {
    const response = await this.request.post("/admin/list-approved-domains", {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: body,
    });

    const responseBody = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: responseBody as ApprovedDomainListResponse,
      errors: responseBody.errors,
    };
  }

  /**
   * POST /admin/get-approved-domain
   * Gets details of a specific approved domain including audit logs.
   *
   * @param sessionToken - Session token for authentication
   * @param request - Request with domain_name and optional audit pagination
   * @returns API response with domain details and audit logs
   */
  async getApprovedDomain(
    sessionToken: string,
    request: GetApprovedDomainRequest
  ): Promise<APIResponse<ApprovedDomainDetailResponse>> {
    const response = await this.request.post("/admin/get-approved-domain", {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: request,
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: body as ApprovedDomainDetailResponse,
      errors: body.errors,
    };
  }

  /**
   * POST /admin/get-approved-domain with raw body for testing invalid payloads
   */
  async getApprovedDomainRaw(
    sessionToken: string,
    body: unknown
  ): Promise<APIResponse<ApprovedDomainDetailResponse>> {
    const response = await this.request.post("/admin/get-approved-domain", {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: body,
    });

    const responseBody = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: responseBody as ApprovedDomainDetailResponse,
      errors: responseBody.errors,
    };
  }

  /**
   * POST /admin/disable-approved-domain
   * Disables an approved domain (changes status to inactive).
   *
   * @param sessionToken - Session token for authentication
   * @param request - Request with domain_name and reason
   * @returns API response (200 on success)
   */
  async disableApprovedDomain(
    sessionToken: string,
    request: DisableApprovedDomainRequest
  ): Promise<APIResponse<void>> {
    const response = await this.request.post("/admin/disable-approved-domain", {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: request,
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: undefined,
      errors: body.errors,
    };
  }

  /**
   * POST /admin/disable-approved-domain with raw body for testing invalid payloads
   */
  async disableApprovedDomainRaw(
    sessionToken: string,
    body: unknown
  ): Promise<APIResponse<void>> {
    const response = await this.request.post("/admin/disable-approved-domain", {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: body,
    });

    const responseBody = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: undefined,
      errors: responseBody.errors,
    };
  }

  /**
   * POST /admin/enable-approved-domain
   * Re-enables a disabled approved domain (changes status to active).
   *
   * @param sessionToken - Session token for authentication
   * @param request - Request with domain_name and reason
   * @returns API response (200 on success)
   */
  async enableApprovedDomain(
    sessionToken: string,
    request: EnableApprovedDomainRequest
  ): Promise<APIResponse<void>> {
    const response = await this.request.post("/admin/enable-approved-domain", {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: request,
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: undefined,
      errors: body.errors,
    };
  }

  /**
   * POST /admin/enable-approved-domain with raw body for testing invalid payloads
   */
  async enableApprovedDomainRaw(
    sessionToken: string,
    body: unknown
  ): Promise<APIResponse<void>> {
    const response = await this.request.post("/admin/enable-approved-domain", {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: body,
    });

    const responseBody = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: undefined,
      errors: responseBody.errors,
    };
  }
}

// ============================================================================
// Hub API Client
// ============================================================================

/**
 * Hub API client for testing hub user signup and authentication endpoints.
 * Wraps Playwright's request context for type-safe API calls.
 */
export class HubAPIClient {
  constructor(private request: APIRequestContext) {}

  /**
   * POST /hub/get-regions
   * Returns list of active regions for dropdown
   */
  async getRegions(): Promise<APIResponse<{ regions: Array<{ region_code: string; region_name: string }> }>> {
    const response = await this.request.post("/hub/get-regions", {
      data: {},
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body,
      errors: body.errors,
    };
  }

  /**
   * POST /hub/get-supported-languages
   * Returns list of supported languages
   */
  async getSupportedLanguages(): Promise<APIResponse<{ languages: Array<any> }>> {
    const response = await this.request.post("/hub/get-supported-languages", {
      data: {},
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body,
      errors: body.errors,
    };
  }

  /**
   * POST /hub/check-domain
   * Checks if a domain is approved for signup
   */
  async checkDomain(domain: string): Promise<APIResponse<{ is_approved: boolean }>> {
    const response = await this.request.post("/hub/check-domain", {
      data: { domain },
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body,
      errors: body.errors,
    };
  }

  /**
   * POST /hub/check-domain with raw body for testing invalid payloads
   */
  async checkDomainRaw(body: unknown): Promise<APIResponse<{ is_approved: boolean }>> {
    const response = await this.request.post("/hub/check-domain", {
      data: body,
    });

    const responseBody = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: responseBody,
      errors: responseBody.errors,
    };
  }

  /**
   * POST /hub/request-signup
   * Requests signup verification email
   */
  async requestSignup(email_address: string): Promise<APIResponse<{ message: string }>> {
    const response = await this.request.post("/hub/request-signup", {
      data: { email_address },
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body,
      errors: body.errors,
    };
  }

  /**
   * POST /hub/request-signup with raw body for testing invalid payloads
   */
  async requestSignupRaw(body: unknown): Promise<APIResponse<{ message: string }>> {
    const response = await this.request.post("/hub/request-signup", {
      data: body,
    });

    const responseBody = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: responseBody,
      errors: responseBody.errors,
    };
  }

  /**
   * POST /hub/complete-signup
   * Completes signup with verification token
   */
  async completeSignup(request: {
    signup_token: string;
    password: string;
    preferred_display_name: string;
    other_display_names?: Array<{ language_code: string; display_name: string }>;
    home_region: string;
    preferred_language: string;
    resident_country_code: string;
  }): Promise<APIResponse<{ session_token: string; handle: string }>> {
    const response = await this.request.post("/hub/complete-signup", {
      data: request,
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body,
      errors: body.errors,
    };
  }

  /**
   * POST /hub/complete-signup with raw body for testing invalid payloads
   */
  async completeSignupRaw(body: unknown): Promise<APIResponse<{ session_token: string; handle: string }>> {
    const response = await this.request.post("/hub/complete-signup", {
      data: body,
    });

    const responseBody = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: responseBody,
      errors: responseBody.errors,
    };
  }

  /**
   * POST /hub/login
   * Login with email and password
   */
  async login(email_address: string, password: string): Promise<APIResponse<{ session_token: string }>> {
    const response = await this.request.post("/hub/login", {
      data: { email_address, password },
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body,
      errors: body.errors,
    };
  }

  /**
   * POST /hub/login with raw body for testing invalid payloads
   */
  async loginRaw(body: unknown): Promise<APIResponse<{ session_token: string }>> {
    const response = await this.request.post("/hub/login", {
      data: body,
    });

    const responseBody = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: responseBody,
      errors: responseBody.errors,
    };
  }

  /**
   * POST /hub/logout
   * Logout (authenticated)
   */
  async logout(session_token: string): Promise<APIResponse<void>> {
    const response = await this.request.post("/hub/logout", {
      headers: { Authorization: `Bearer ${session_token}` },
      data: { session_token },
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: undefined,
      errors: body.errors,
    };
  }

  /**
   * POST /hub/logout with raw body for testing invalid payloads
   */
  async logoutRaw(session_token: string, body: unknown): Promise<APIResponse<void>> {
    const response = await this.request.post("/hub/logout", {
      headers: { Authorization: `Bearer ${session_token}` },
      data: body,
    });

    const responseBody = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: undefined,
      errors: responseBody.errors,
    };
  }
}
