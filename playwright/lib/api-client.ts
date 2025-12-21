import { APIRequestContext } from "@playwright/test";

/**
 * Base URL for the API server (via nginx load balancer)
 */
export const API_BASE_URL = "http://localhost:8080";

// ============================================================================
// Request/Response Types
// ============================================================================

export interface AdminLoginRequest {
  email: string;
  password: string;
}

export interface AdminLoginResponse {
  tfa_token: string;
}

export interface AdminTFARequest {
  tfa_token: string;
  tfa_code: string;
}

export interface AdminTFAResponse {
  session_token: string;
}

export interface AdminLogoutRequest {
  session_token: string;
}

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
}
