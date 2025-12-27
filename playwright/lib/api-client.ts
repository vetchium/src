import { APIRequestContext } from "@playwright/test";
import {
  AdminLoginResponse,
  AdminTFAResponse,
} from "../../specs/typespec/admin/admin-users";
import type {
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
   * @param email - Admin email address
   * @param password - Admin password
   * @returns API response with TFA token on success
   */
  async login(email: string, password: string): Promise<APIResponse<AdminLoginResponse>> {
    const response = await this.request.post("/admin/login", {
      data: { email, password },
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
   * @param tfaToken - TFA token from login response
   * @param tfaCode - 6-digit TFA code from email
   * @returns API response with session token on success
   */
  async verifyTFA(tfaToken: string, tfaCode: string): Promise<APIResponse<AdminTFAResponse>> {
    const response = await this.request.post("/admin/tfa", {
      data: { tfa_token: tfaToken, tfa_code: tfaCode },
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
   * @param sessionToken - Session token from TFA response
   * @returns API response (empty body on success)
   */
  async logout(sessionToken: string): Promise<APIResponse<void>> {
    const response = await this.request.post("/admin/logout", {
      data: { session_token: sessionToken },
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
   * @param domainName - Domain name to approve
   * @returns API response with created domain on success (201)
   */
  async createApprovedDomain(
    sessionToken: string,
    domainName: string
  ): Promise<APIResponse<ApprovedDomainDetailResponse["domain"]>> {
    const response = await this.request.post("/admin/add-approved-domain", {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: { domain_name: domainName },
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: body as ApprovedDomainDetailResponse["domain"],
      errors: body.errors,
    };
  }

  /**
   * POST /admin/list-approved-domains
   * Lists approved domains with optional filtering and search.
   *
   * @param sessionToken - Session token for authentication
   * @param options - Optional parameters (limit, cursor, query, filter)
   * @returns API response with list of domains
   */
  async listApprovedDomains(
    sessionToken: string,
    options?: { limit?: number; cursor?: string; query?: string; filter?: "active" | "inactive" | "all" }
  ): Promise<APIResponse<ApprovedDomainListResponse>> {
    const response = await this.request.post("/admin/list-approved-domains", {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: {
        limit: options?.limit,
        cursor: options?.cursor,
        query: options?.query,
        filter: options?.filter || "active",
      },
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: body as ApprovedDomainListResponse,
      errors: body.errors,
    };
  }

  /**
   * POST /admin/get-approved-domain
   * Gets details of a specific approved domain including audit logs.
   *
   * @param sessionToken - Session token for authentication
   * @param domainName - Domain name to fetch
   * @returns API response with domain details and audit logs
   */
  async getApprovedDomain(
    sessionToken: string,
    domainName: string
  ): Promise<APIResponse<ApprovedDomainDetailResponse>> {
    const response = await this.request.post("/admin/get-approved-domain", {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: { domain_name: domainName },
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: body as ApprovedDomainDetailResponse,
      errors: body.errors,
    };
  }

  /**
   * POST /admin/disable-approved-domain
   * Disables an approved domain (changes status to inactive).
   *
   * @param sessionToken - Session token for authentication
   * @param domainName - Domain name to disable
   * @param reason - Reason for disabling (max 256 chars)
   * @returns API response (200 on success)
   */
  async disableApprovedDomain(
    sessionToken: string,
    domainName: string,
    reason: string
  ): Promise<APIResponse<void>> {
    const response = await this.request.post("/admin/disable-approved-domain", {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: { domain_name: domainName, reason },
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: undefined,
      errors: body.errors,
    };
  }

  /**
   * POST /admin/enable-approved-domain
   * Re-enables a disabled approved domain (changes status to active).
   *
   * @param sessionToken - Session token for authentication
   * @param domainName - Domain name to enable
   * @param reason - Reason for enabling (max 256 chars)
   * @returns API response (200 on success)
   */
  async enableApprovedDomain(
    sessionToken: string,
    domainName: string,
    reason: string
  ): Promise<APIResponse<void>> {
    const response = await this.request.post("/admin/enable-approved-domain", {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: { domain_name: domainName, reason },
    });

    const body = await response.json().catch(() => ({}));
    return {
      status: response.status(),
      body: undefined,
      errors: body.errors,
    };
  }
}
