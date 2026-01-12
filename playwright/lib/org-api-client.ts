import { APIRequestContext } from "@playwright/test";
import type {
	OrgInitSignupRequest,
	OrgInitSignupResponse,
	OrgCompleteSignupRequest,
	OrgCompleteSignupResponse,
	OrgLoginRequest,
	OrgLoginResponse,
	OrgTFARequest,
	OrgTFAResponse,
} from "vetchium-specs/org/org-users";
import type {
	ClaimDomainRequest,
	ClaimDomainResponse,
	VerifyDomainRequest,
	VerifyDomainResponse,
	GetDomainStatusRequest,
	GetDomainStatusResponse,
} from "vetchium-specs/orgdomains/orgdomains";
import type { APIResponse } from "./api-client";

/**
 * Org API client for testing org user signup and domain verification endpoints.
 * Wraps Playwright's request context for type-safe API calls.
 */
export class OrgAPIClient {
	constructor(private request: APIRequestContext) {}

	/**
	 * POST /org/init-signup
	 * Requests signup verification email
	 */
	async initSignup(
		request: OrgInitSignupRequest
	): Promise<APIResponse<OrgInitSignupResponse>> {
		const response = await this.request.post("/org/init-signup", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgInitSignupResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /org/init-signup with raw body for testing invalid payloads
	 */
	async initSignupRaw(
		body: unknown
	): Promise<APIResponse<OrgInitSignupResponse>> {
		const response = await this.request.post("/org/init-signup", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgInitSignupResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /org/complete-signup
	 * Completes signup with verification token
	 */
	async completeSignup(
		request: OrgCompleteSignupRequest
	): Promise<APIResponse<OrgCompleteSignupResponse>> {
		const response = await this.request.post("/org/complete-signup", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgCompleteSignupResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /org/complete-signup with raw body for testing invalid payloads
	 */
	async completeSignupRaw(
		body: unknown
	): Promise<APIResponse<OrgCompleteSignupResponse>> {
		const response = await this.request.post("/org/complete-signup", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgCompleteSignupResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /org/claim-domain
	 * Claims a domain for verification
	 */
	async claimDomain(
		sessionToken: string,
		request: ClaimDomainRequest
	): Promise<APIResponse<ClaimDomainResponse>> {
		const response = await this.request.post("/org/claim-domain", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ClaimDomainResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /org/claim-domain with raw body for testing invalid payloads
	 */
	async claimDomainRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<ClaimDomainResponse>> {
		const response = await this.request.post("/org/claim-domain", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as ClaimDomainResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /org/claim-domain without Authorization header (for testing 401)
	 */
	async claimDomainWithoutAuth(
		request: ClaimDomainRequest
	): Promise<APIResponse<ClaimDomainResponse>> {
		const response = await this.request.post("/org/claim-domain", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ClaimDomainResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /org/verify-domain
	 * Triggers manual DNS verification for a claimed domain
	 */
	async verifyDomain(
		sessionToken: string,
		request: VerifyDomainRequest
	): Promise<APIResponse<VerifyDomainResponse>> {
		const response = await this.request.post("/org/verify-domain", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as VerifyDomainResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /org/verify-domain with raw body for testing invalid payloads
	 */
	async verifyDomainRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<VerifyDomainResponse>> {
		const response = await this.request.post("/org/verify-domain", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as VerifyDomainResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /org/verify-domain without Authorization header (for testing 401)
	 */
	async verifyDomainWithoutAuth(
		request: VerifyDomainRequest
	): Promise<APIResponse<VerifyDomainResponse>> {
		const response = await this.request.post("/org/verify-domain", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as VerifyDomainResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /org/get-domain-status
	 * Gets current verification status of a claimed domain
	 */
	async getDomainStatus(
		sessionToken: string,
		request: GetDomainStatusRequest
	): Promise<APIResponse<GetDomainStatusResponse>> {
		const response = await this.request.post("/org/get-domain-status", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as GetDomainStatusResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /org/get-domain-status with raw body for testing invalid payloads
	 */
	async getDomainStatusRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<GetDomainStatusResponse>> {
		const response = await this.request.post("/org/get-domain-status", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as GetDomainStatusResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /org/get-domain-status without Authorization header (for testing 401)
	 */
	async getDomainStatusWithoutAuth(
		request: GetDomainStatusRequest
	): Promise<APIResponse<GetDomainStatusResponse>> {
		const response = await this.request.post("/org/get-domain-status", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as GetDomainStatusResponse,
			errors: body.errors,
		};
	}

	// ============================================================================
	// Login / TFA / Logout
	// ============================================================================

	/**
	 * POST /employer/login
	 * Initiates org user login with email, domain, and password.
	 * On success, returns a TFA token and sends TFA code via email.
	 *
	 * @param request - Login request with email, domain, and password
	 * @returns API response with TFA token on success
	 */
	async login(request: OrgLoginRequest): Promise<APIResponse<OrgLoginResponse>> {
		const response = await this.request.post("/employer/login", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgLoginResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /employer/login with raw body for testing invalid payloads
	 */
	async loginRaw(body: unknown): Promise<APIResponse<OrgLoginResponse>> {
		const response = await this.request.post("/employer/login", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgLoginResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /employer/tfa
	 * Verifies TFA code and returns session token on success.
	 *
	 * @param request - TFA request with tfa_token, tfa_code, and remember_me
	 * @returns API response with session token on success
	 */
	async verifyTFA(request: OrgTFARequest): Promise<APIResponse<OrgTFAResponse>> {
		const response = await this.request.post("/employer/tfa", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgTFAResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /employer/tfa with raw body for testing invalid payloads
	 */
	async verifyTFARaw(body: unknown): Promise<APIResponse<OrgTFAResponse>> {
		const response = await this.request.post("/employer/tfa", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgTFAResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /employer/logout
	 * Invalidates the session token via Authorization header.
	 *
	 * @param sessionToken - Session token to invalidate
	 * @returns API response (empty body on success)
	 */
	async logout(sessionToken: string): Promise<APIResponse<void>> {
		const response = await this.request.post("/employer/logout", {
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
	 * POST /employer/logout without Authorization header (for testing 401)
	 */
	async logoutWithoutAuth(): Promise<APIResponse<void>> {
		const response = await this.request.post("/employer/logout", {
			data: {},
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: undefined,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}
}
