import { APIRequestContext } from "@playwright/test";
import type {
	RequestSignupRequest,
	RequestSignupResponse,
	CompleteSignupRequest,
	CompleteSignupResponse,
	HubLoginRequest,
	HubLoginResponse,
	HubLogoutRequest,
} from "vetchium-specs/hub/hub-users";
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
			errors: body.errors,
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
			errors: responseBody.errors,
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
			errors: body.errors,
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
			errors: responseBody.errors,
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
			errors: body.errors,
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
			errors: responseBody.errors,
		};
	}

	/**
	 * POST /hub/logout
	 * Logout (authenticated)
	 */
	async logout(request: HubLogoutRequest): Promise<APIResponse<void>> {
		const response = await this.request.post("/hub/logout", {
			headers: { Authorization: `Bearer ${request.session_token}` },
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
	 * POST /hub/logout with raw body for testing invalid payloads
	 */
	async logoutRaw(
		session_token: string,
		body: unknown
	): Promise<APIResponse<void>> {
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
