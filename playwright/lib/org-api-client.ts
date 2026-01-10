import { APIRequestContext } from "@playwright/test";
import type {
	OrgInitSignupRequest,
	OrgInitSignupResponse,
	OrgCompleteSignupRequest,
	OrgCompleteSignupResponse,
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
}
