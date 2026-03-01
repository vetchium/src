import { APIRequestContext } from "@playwright/test";
import type {
	RequestSignupRequest,
	RequestSignupResponse,
	CompleteSignupRequest,
	CompleteSignupResponse,
	HubLoginRequest,
	HubLoginResponse,
	HubTFARequest,
	HubTFAResponse,
	HubMyInfoResponse,
	HubSetLanguageRequest,
	HubRequestPasswordResetRequest,
	HubRequestPasswordResetResponse,
	HubCompletePasswordResetRequest,
	HubChangePasswordRequest,
	HubRequestEmailChangeRequest,
	HubRequestEmailChangeResponse,
	HubCompleteEmailChangeRequest,
} from "vetchium-specs/hub/hub-users";
import type {
	GetTagRequest,
	FilterTagsRequest,
	FilterTagsResponse,
	Tag,
} from "vetchium-specs/hub/tags";
import type { APIResponse } from "./api-client";

/**
 * Hub API client for testing hub user signup and authentication endpoints.
 * Wraps Playwright's request context for type-safe API calls.
 */
export class HubAPIClient {
	constructor(private request: APIRequestContext) {}

	/**
	 * POST /hub/request-signup
	 * Requests signup verification email
	 */
	async requestSignup(
		request: RequestSignupRequest
	): Promise<APIResponse<RequestSignupResponse>> {
		const response = await this.request.post("/hub/request-signup", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as RequestSignupResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/request-signup with raw body for testing invalid payloads
	 */
	async requestSignupRaw(
		body: unknown
	): Promise<APIResponse<RequestSignupResponse>> {
		const response = await this.request.post("/hub/request-signup", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as RequestSignupResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /hub/complete-signup
	 * Completes signup with verification token
	 */
	async completeSignup(
		request: CompleteSignupRequest
	): Promise<APIResponse<CompleteSignupResponse>> {
		const response = await this.request.post("/hub/complete-signup", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as CompleteSignupResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/complete-signup with raw body for testing invalid payloads
	 */
	async completeSignupRaw(
		body: unknown
	): Promise<APIResponse<CompleteSignupResponse>> {
		const response = await this.request.post("/hub/complete-signup", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as CompleteSignupResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /hub/login
	 * Login with email and password
	 */
	async login(
		request: HubLoginRequest
	): Promise<APIResponse<HubLoginResponse>> {
		const response = await this.request.post("/hub/login", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as HubLoginResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/login with raw body for testing invalid payloads
	 */
	async loginRaw(body: unknown): Promise<APIResponse<HubLoginResponse>> {
		const response = await this.request.post("/hub/login", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as HubLoginResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /hub/tfa
	 * Verify TFA code and get session token
	 */
	async verifyTFA(
		request: HubTFARequest
	): Promise<APIResponse<HubTFAResponse>> {
		const response = await this.request.post("/hub/tfa", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as HubTFAResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/tfa with raw body for testing invalid payloads
	 */
	async verifyTFARaw(body: unknown): Promise<APIResponse<HubTFAResponse>> {
		const response = await this.request.post("/hub/tfa", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as HubTFAResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /hub/logout
	 * Invalidates the session token via Authorization header.
	 *
	 * @param sessionToken - Session token to invalidate
	 * @returns API response (empty body on success)
	 */
	async logout(sessionToken: string): Promise<APIResponse<void>> {
		const response = await this.request.post("/hub/logout", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: {},
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: undefined,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/logout with raw body for testing invalid payloads
	 * Note: Session token must still be in header for auth
	 */
	async logoutRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/hub/logout", {
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
	 * GET /hub/myinfo
	 * Returns hub user information for the current session
	 */
	async getMyInfo(
		sessionToken: string
	): Promise<APIResponse<HubMyInfoResponse>> {
		const response = await this.request.get("/hub/myinfo", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as HubMyInfoResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * GET /hub/myinfo without Authorization header (for testing 401)
	 */
	async getMyInfoWithoutAuth(): Promise<APIResponse<HubMyInfoResponse>> {
		const response = await this.request.get("/hub/myinfo");

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as HubMyInfoResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/logout without Authorization header (for testing 401)
	 */
	async logoutWithoutAuth(body: unknown = {}): Promise<APIResponse<void>> {
		const response = await this.request.post("/hub/logout", {
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
	 * POST /hub/set-language
	 * Update user's preferred language
	 */
	async setLanguage(
		sessionToken: string,
		request: HubSetLanguageRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/hub/set-language", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: request,
		});

		return {
			status: response.status(),
			body: undefined,
			errors: undefined,
		};
	}

	/**
	 * POST /hub/set-language with raw body for testing invalid payloads
	 */
	async setLanguageRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/hub/set-language", {
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
	 * POST /hub/request-password-reset
	 * Requests password reset email
	 */
	async requestPasswordReset(
		request: HubRequestPasswordResetRequest
	): Promise<APIResponse<HubRequestPasswordResetResponse>> {
		const response = await this.request.post("/hub/request-password-reset", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as HubRequestPasswordResetResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/request-password-reset with raw body for testing invalid payloads
	 */
	async requestPasswordResetRaw(
		body: unknown
	): Promise<APIResponse<HubRequestPasswordResetResponse>> {
		const response = await this.request.post("/hub/request-password-reset", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as HubRequestPasswordResetResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /hub/complete-password-reset
	 * Completes password reset with reset token
	 */
	async completePasswordReset(
		request: HubCompletePasswordResetRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/hub/complete-password-reset", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: undefined,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/complete-password-reset with raw body for testing invalid payloads
	 */
	async completePasswordResetRaw(body: unknown): Promise<APIResponse<void>> {
		const response = await this.request.post("/hub/complete-password-reset", {
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
	 * POST /hub/change-password
	 * Changes user password while authenticated
	 */
	async changePassword(
		sessionToken: string,
		request: HubChangePasswordRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/hub/change-password", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: undefined,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/change-password with raw body for testing invalid payloads
	 */
	async changePasswordRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/hub/change-password", {
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
	 * POST /hub/request-email-change
	 * Request email change with new email address
	 */
	async requestEmailChange(
		sessionToken: string,
		request: HubRequestEmailChangeRequest
	): Promise<APIResponse<HubRequestEmailChangeResponse>> {
		const response = await this.request.post("/hub/request-email-change", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as HubRequestEmailChangeResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/request-email-change with raw body for testing invalid payloads
	 */
	async requestEmailChangeRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<HubRequestEmailChangeResponse>> {
		const response = await this.request.post("/hub/request-email-change", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as HubRequestEmailChangeResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /hub/complete-email-change
	 * Complete email change with verification token
	 */
	async completeEmailChange(
		request: HubCompleteEmailChangeRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/hub/complete-email-change", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: undefined,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/complete-email-change with raw body for testing invalid payloads
	 */
	async completeEmailChangeRaw(body: unknown): Promise<APIResponse<void>> {
		const response = await this.request.post("/hub/complete-email-change", {
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
	 * POST /hub/get-tag
	 * Gets a tag by ID for the given locale
	 */
	async getTag(
		sessionToken: string,
		request: GetTagRequest
	): Promise<APIResponse<Tag>> {
		const response = await this.request.post("/hub/get-tag", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as Tag,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/filter-tags
	 * Filters tags by query with pagination
	 */
	async filterTags(
		sessionToken: string,
		request: FilterTagsRequest
	): Promise<APIResponse<FilterTagsResponse>> {
		const response = await this.request.post("/hub/filter-tags", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as FilterTagsResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}
}
