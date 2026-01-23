import { APIRequestContext } from "@playwright/test";
import type {
	AgencyInitSignupRequest,
	AgencyInitSignupResponse,
	AgencyGetSignupDetailsRequest,
	AgencyGetSignupDetailsResponse,
	AgencyCompleteSignupRequest,
	AgencyCompleteSignupResponse,
	AgencyLoginRequest,
	AgencyLoginResponse,
	AgencyTFARequest,
	AgencyTFAResponse,
	AgencyDisableUserRequest,
	AgencyEnableUserRequest,
} from "vetchium-specs/agency/agency-users";
import type { APIResponse } from "./api-client";

/**
 * Agency API client for testing agency user signup and authentication endpoints.
 * Wraps Playwright's request context for type-safe API calls.
 */
export class AgencyAPIClient {
	constructor(private request: APIRequestContext) {}

	/**
	 * POST /agency/init-signup
	 * Requests signup verification email with DNS instructions
	 */
	async initSignup(
		request: AgencyInitSignupRequest
	): Promise<APIResponse<AgencyInitSignupResponse>> {
		const response = await this.request.post("/agency/init-signup", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as AgencyInitSignupResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /agency/init-signup with raw body for testing invalid payloads
	 */
	async initSignupRaw(
		body: unknown
	): Promise<APIResponse<AgencyInitSignupResponse>> {
		const response = await this.request.post("/agency/init-signup", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as AgencyInitSignupResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /agency/get-signup-details
	 * Gets domain being verified for a signup token
	 */
	async getSignupDetails(
		request: AgencyGetSignupDetailsRequest
	): Promise<APIResponse<AgencyGetSignupDetailsResponse>> {
		const response = await this.request.post("/agency/get-signup-details", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as AgencyGetSignupDetailsResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /agency/get-signup-details with raw body for testing invalid payloads
	 */
	async getSignupDetailsRaw(
		body: unknown
	): Promise<APIResponse<AgencyGetSignupDetailsResponse>> {
		const response = await this.request.post("/agency/get-signup-details", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as AgencyGetSignupDetailsResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /agency/complete-signup
	 * Completes signup with verification token and DNS verification
	 */
	async completeSignup(
		request: AgencyCompleteSignupRequest
	): Promise<APIResponse<AgencyCompleteSignupResponse>> {
		const response = await this.request.post("/agency/complete-signup", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as AgencyCompleteSignupResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /agency/complete-signup with raw body for testing invalid payloads
	 */
	async completeSignupRaw(
		body: unknown
	): Promise<APIResponse<AgencyCompleteSignupResponse>> {
		const response = await this.request.post("/agency/complete-signup", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as AgencyCompleteSignupResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	// ============================================================================
	// Login / TFA / Logout
	// ============================================================================

	/**
	 * POST /agency/login
	 * Initiates agency user login with email, domain, and password.
	 * On success, returns a TFA token and sends TFA code via email.
	 *
	 * @param request - Login request with email, domain, and password
	 * @returns API response with TFA token on success
	 */
	async login(
		request: AgencyLoginRequest
	): Promise<APIResponse<AgencyLoginResponse>> {
		const response = await this.request.post("/agency/login", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as AgencyLoginResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /agency/login with raw body for testing invalid payloads
	 */
	async loginRaw(body: unknown): Promise<APIResponse<AgencyLoginResponse>> {
		const response = await this.request.post("/agency/login", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as AgencyLoginResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /agency/tfa
	 * Verifies TFA code and returns session token on success.
	 *
	 * @param request - TFA request with tfa_token, tfa_code, and remember_me
	 * @returns API response with session token on success
	 */
	async verifyTFA(
		request: AgencyTFARequest
	): Promise<APIResponse<AgencyTFAResponse>> {
		const response = await this.request.post("/agency/tfa", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as AgencyTFAResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /agency/tfa with raw body for testing invalid payloads
	 */
	async verifyTFARaw(body: unknown): Promise<APIResponse<AgencyTFAResponse>> {
		const response = await this.request.post("/agency/tfa", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as AgencyTFAResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /agency/logout
	 * Invalidates the session token via Authorization header.
	 *
	 * @param sessionToken - Session token to invalidate
	 * @returns API response (empty body on success)
	 */
	async logout(sessionToken: string): Promise<APIResponse<void>> {
		const response = await this.request.post("/agency/logout", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: {},
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: undefined,
			errors: body.errors,
		};
	}

	/**
	 * POST /agency/logout without Authorization header (for testing 401)
	 */
	async logoutWithoutAuth(): Promise<APIResponse<void>> {
		const response = await this.request.post("/agency/logout", {
			data: {},
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: undefined,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	// ============================================================================
	// User Management (Disable/Enable)
	// ============================================================================

	/**
	 * POST /agency/disable-user
	 * Disables a user in the agency.
	 * Requires authentication and admin privileges.
	 *
	 * @param sessionToken - Session token of the admin
	 * @param request - Disable request with target_user_id
	 * @returns API response (empty body on success)
	 */
	async disableUser(
		sessionToken: string,
		request: AgencyDisableUserRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/agency/disable-user", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
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
	 * POST /agency/disable-user with raw body for testing invalid payloads
	 */
	async disableUserRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/agency/disable-user", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: undefined,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /agency/enable-user
	 * Enables a previously disabled user in the agency.
	 * Requires authentication and admin privileges.
	 *
	 * @param sessionToken - Session token of the admin
	 * @param request - Enable request with target_user_id
	 * @returns API response (empty body on success)
	 */
	async enableUser(
		sessionToken: string,
		request: AgencyEnableUserRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/agency/enable-user", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
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
	 * POST /agency/enable-user with raw body for testing invalid payloads
	 */
	async enableUserRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/agency/enable-user", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: undefined,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}
}
