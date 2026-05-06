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
import type {
	HubProfileOwnerView,
	HubProfilePublicView,
	UpdateMyProfileRequest,
	GetProfileRequest,
} from "vetchium-specs/hub/profile";
import type {
	FilterAuditLogsRequest,
	FilterAuditLogsResponse,
} from "vetchium-specs/audit-logs/audit-logs";
import type {
	AddWorkEmailRequest,
	AddWorkEmailResponse,
	VerifyWorkEmailRequest,
	ResendWorkEmailCodeRequest,
	ReverifyWorkEmailRequest,
	RemoveWorkEmailRequest,
	GetMyWorkEmailRequest,
	ListMyWorkEmailsRequest,
	ListMyWorkEmailsResponse,
	ListPublicEmployerStintsRequest,
	ListPublicEmployerStintsResponse,
	WorkEmailStintOwnerView,
} from "vetchium-specs/hub/work-emails";
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
	 * POST /hub/list-tags
	 * Filters tags by query with pagination
	 */
	async listTags(
		sessionToken: string,
		request: FilterTagsRequest
	): Promise<APIResponse<FilterTagsResponse>> {
		const response = await this.request.post("/hub/list-tags", {
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

	// ============================================================================
	// Audit Logs
	// ============================================================================

	/**
	 * POST /hub/list-audit-logs
	 * Retrieves the calling hub user's own audit log entries.
	 * No special role required; results are always scoped to the authenticated user.
	 */
	async listAuditLogs(
		sessionToken: string,
		request: FilterAuditLogsRequest
	): Promise<APIResponse<FilterAuditLogsResponse>> {
		const response = await this.request.post("/hub/list-audit-logs", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as FilterAuditLogsResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/list-audit-logs with raw body for testing invalid payloads
	 */
	async listAuditLogsRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<FilterAuditLogsResponse>> {
		const response = await this.request.post("/hub/list-audit-logs", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as FilterAuditLogsResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /hub/list-audit-logs without Authorization header (for testing 401)
	 */
	async listAuditLogsWithoutAuth(
		request: FilterAuditLogsRequest
	): Promise<APIResponse<FilterAuditLogsResponse>> {
		const response = await this.request.post("/hub/list-audit-logs", {
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as FilterAuditLogsResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	// ============================================================================
	// Profile
	// ============================================================================

	/**
	 * GET /hub/get-my-profile
	 * Returns the authenticated user's own profile (owner view).
	 */
	async getMyProfile(
		sessionToken: string
	): Promise<APIResponse<HubProfileOwnerView>> {
		const response = await this.request.get("/hub/get-my-profile", {
			headers: { Authorization: `Bearer ${sessionToken}` },
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as HubProfileOwnerView,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * GET /hub/get-my-profile without Authorization header (for testing 401)
	 */
	async getMyProfileRaw(): Promise<APIResponse<HubProfileOwnerView>> {
		const response = await this.request.get("/hub/get-my-profile");
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as HubProfileOwnerView,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/update-my-profile
	 * Updates the authenticated user's profile fields.
	 */
	async updateMyProfile(
		sessionToken: string,
		request: UpdateMyProfileRequest
	): Promise<APIResponse<HubProfileOwnerView>> {
		const response = await this.request.post("/hub/update-my-profile", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as HubProfileOwnerView,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/update-my-profile with raw body for testing invalid payloads
	 */
	async updateMyProfileRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<HubProfileOwnerView>> {
		const response = await this.request.post("/hub/update-my-profile", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as HubProfileOwnerView,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /hub/upload-profile-picture
	 * Uploads a profile picture as multipart/form-data.
	 */
	async uploadProfilePicture(
		sessionToken: string,
		fileBuffer: Buffer,
		fileName: string,
		mimeType: string
	): Promise<APIResponse<HubProfileOwnerView>> {
		const response = await this.request.post("/hub/upload-profile-picture", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			multipart: {
				image: {
					name: fileName,
					mimeType: mimeType,
					buffer: fileBuffer,
				},
			},
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as HubProfileOwnerView,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/upload-profile-picture without Authorization header (for testing 401)
	 */
	async uploadProfilePictureRaw(
		sessionToken: string | null,
		fileBuffer: Buffer,
		fileName: string,
		mimeType: string
	): Promise<APIResponse<HubProfileOwnerView>> {
		const headers: Record<string, string> = {};
		if (sessionToken) {
			headers["Authorization"] = `Bearer ${sessionToken}`;
		}
		const response = await this.request.post("/hub/upload-profile-picture", {
			headers,
			multipart: {
				image: {
					name: fileName,
					mimeType: mimeType,
					buffer: fileBuffer,
				},
			},
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as HubProfileOwnerView,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/remove-profile-picture
	 * Removes the authenticated user's profile picture.
	 */
	async removeProfilePicture(
		sessionToken: string
	): Promise<APIResponse<HubProfileOwnerView>> {
		const response = await this.request.post("/hub/remove-profile-picture", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: {},
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as HubProfileOwnerView,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/remove-profile-picture without Authorization header (for testing 401)
	 */
	async removeProfilePictureRaw(): Promise<APIResponse<HubProfileOwnerView>> {
		const response = await this.request.post("/hub/remove-profile-picture", {
			data: {},
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as HubProfileOwnerView,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/get-profile
	 * Returns the public-view profile of a hub user by handle.
	 */
	async getProfile(
		sessionToken: string,
		request: GetProfileRequest
	): Promise<APIResponse<HubProfilePublicView>> {
		const response = await this.request.post("/hub/get-profile", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as HubProfilePublicView,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /hub/get-profile with raw body for testing invalid payloads
	 */
	async getProfileRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<HubProfilePublicView>> {
		const response = await this.request.post("/hub/get-profile", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as HubProfilePublicView,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * GET /hub/profile-picture/{handle}
	 * Fetches the profile picture bytes for a hub user.
	 * Returns status + Content-Type + raw bytes.
	 */
	async getProfilePictureBytes(
		sessionToken: string,
		handle: string
	): Promise<{ status: number; contentType: string | null; bytes: Buffer }> {
		const response = await this.request.get(
			`/hub/profile-picture/${encodeURIComponent(handle)}`,
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
			}
		);
		const bytes = await response.body();
		return {
			status: response.status(),
			contentType: response.headers()["content-type"] ?? null,
			bytes: Buffer.from(bytes),
		};
	}

	// ============================================================================
	// Work Emails
	// ============================================================================

	async addWorkEmail(
		sessionToken: string,
		request: AddWorkEmailRequest
	): Promise<APIResponse<AddWorkEmailResponse>> {
		const response = await this.request.post("/hub/add-work-email", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as AddWorkEmailResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async addWorkEmailRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<AddWorkEmailResponse>> {
		const response = await this.request.post("/hub/add-work-email", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as AddWorkEmailResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async verifyWorkEmail(
		sessionToken: string,
		request: VerifyWorkEmailRequest
	): Promise<APIResponse<WorkEmailStintOwnerView>> {
		const response = await this.request.post("/hub/verify-work-email", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as WorkEmailStintOwnerView,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async verifyWorkEmailRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<WorkEmailStintOwnerView>> {
		const response = await this.request.post("/hub/verify-work-email", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as WorkEmailStintOwnerView,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async resendWorkEmailCode(
		sessionToken: string,
		request: ResendWorkEmailCodeRequest
	): Promise<APIResponse<WorkEmailStintOwnerView>> {
		const response = await this.request.post("/hub/resend-work-email-code", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as WorkEmailStintOwnerView,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async resendWorkEmailCodeRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<WorkEmailStintOwnerView>> {
		const response = await this.request.post("/hub/resend-work-email-code", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as WorkEmailStintOwnerView,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async reverifyWorkEmail(
		sessionToken: string,
		request: ReverifyWorkEmailRequest
	): Promise<APIResponse<WorkEmailStintOwnerView>> {
		const response = await this.request.post("/hub/reverify-work-email", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as WorkEmailStintOwnerView,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async reverifyWorkEmailRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<WorkEmailStintOwnerView>> {
		const response = await this.request.post("/hub/reverify-work-email", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as WorkEmailStintOwnerView,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async removeWorkEmail(
		sessionToken: string,
		request: RemoveWorkEmailRequest
	): Promise<APIResponse<WorkEmailStintOwnerView>> {
		const response = await this.request.post("/hub/remove-work-email", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as WorkEmailStintOwnerView,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async removeWorkEmailRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<WorkEmailStintOwnerView>> {
		const response = await this.request.post("/hub/remove-work-email", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as WorkEmailStintOwnerView,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async listMyWorkEmails(
		sessionToken: string,
		request: ListMyWorkEmailsRequest
	): Promise<APIResponse<ListMyWorkEmailsResponse>> {
		const response = await this.request.post("/hub/list-my-work-emails", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ListMyWorkEmailsResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async listMyWorkEmailsRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<ListMyWorkEmailsResponse>> {
		const response = await this.request.post("/hub/list-my-work-emails", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as ListMyWorkEmailsResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async getMyWorkEmail(
		sessionToken: string,
		request: GetMyWorkEmailRequest
	): Promise<APIResponse<WorkEmailStintOwnerView>> {
		const response = await this.request.post("/hub/get-my-work-email", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as WorkEmailStintOwnerView,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async getMyWorkEmailRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<WorkEmailStintOwnerView>> {
		const response = await this.request.post("/hub/get-my-work-email", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as WorkEmailStintOwnerView,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async listPublicEmployerStints(
		sessionToken: string,
		request: ListPublicEmployerStintsRequest
	): Promise<APIResponse<ListPublicEmployerStintsResponse>> {
		const response = await this.request.post(
			"/hub/list-public-employer-stints",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ListPublicEmployerStintsResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async listPublicEmployerStintsRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<ListPublicEmployerStintsResponse>> {
		const response = await this.request.post(
			"/hub/list-public-employer-stints",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: body,
			}
		);
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as ListPublicEmployerStintsResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	// Connection endpoints
	async sendConnectionRequest(
		sessionToken: string,
		request: { handle: string }
	): Promise<APIResponse<unknown>> {
		const response = await this.request.post("/hub/connections/send-request", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body,
		};
	}

	async getConnectionStatus(
		sessionToken: string,
		request: { handle: string }
	): Promise<APIResponse<{ connection_state: string }>> {
		const response = await this.request.post("/hub/connections/get-status", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body,
		};
	}

	async acceptConnectionRequest(
		sessionToken: string,
		request: { handle: string }
	): Promise<APIResponse<unknown>> {
		const response = await this.request.post(
			"/hub/connections/accept-request",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body,
		};
	}

	async rejectConnectionRequest(
		sessionToken: string,
		request: { handle: string }
	): Promise<APIResponse<unknown>> {
		const response = await this.request.post(
			"/hub/connections/reject-request",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body,
		};
	}

	async withdrawConnectionRequest(
		sessionToken: string,
		request: { handle: string }
	): Promise<APIResponse<unknown>> {
		const response = await this.request.post(
			"/hub/connections/withdraw-request",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		return {
			status: response.status(),
			body: null,
		};
	}

	async disconnect(
		sessionToken: string,
		request: { handle: string }
	): Promise<APIResponse<unknown>> {
		const response = await this.request.post("/hub/connections/disconnect", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		return {
			status: response.status(),
			body: null,
		};
	}

	async blockUser(
		sessionToken: string,
		request: { handle: string }
	): Promise<APIResponse<unknown>> {
		const response = await this.request.post("/hub/connections/block", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body,
		};
	}

	async unblockUser(
		sessionToken: string,
		request: { handle: string }
	): Promise<APIResponse<unknown>> {
		const response = await this.request.post("/hub/connections/unblock", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		return {
			status: response.status(),
			body: null,
		};
	}

	async listConnections(
		sessionToken: string,
		request?: { limit?: number; pagination_key?: string; filter_query?: string }
	): Promise<
		APIResponse<{ connections: unknown[]; next_pagination_key?: string }>
	> {
		const response = await this.request.post("/hub/connections/list", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request || {},
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body,
		};
	}

	async listIncomingRequests(
		sessionToken: string,
		request?: { limit?: number; pagination_key?: string }
	): Promise<
		APIResponse<{ incoming: unknown[]; next_pagination_key?: string }>
	> {
		const response = await this.request.post(
			"/hub/connections/list-incoming-requests",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request || {},
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body,
		};
	}

	async listOutgoingRequests(
		sessionToken: string,
		request?: { limit?: number; pagination_key?: string }
	): Promise<
		APIResponse<{ outgoing: unknown[]; next_pagination_key?: string }>
	> {
		const response = await this.request.post(
			"/hub/connections/list-outgoing-requests",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request || {},
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body,
		};
	}

	async searchConnections(
		sessionToken: string,
		request: { query: string }
	): Promise<APIResponse<{ results: unknown[] }>> {
		const response = await this.request.post("/hub/connections/search", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body,
		};
	}

	async getConnectionCounts(
		sessionToken: string
	): Promise<
		APIResponse<{
			pending_incoming: number;
			pending_outgoing: number;
			connected: number;
			blocked: number;
		}>
	> {
		const response = await this.request.get("/hub/connections/counts", {
			headers: { Authorization: `Bearer ${sessionToken}` },
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body,
		};
	}

	async listBlockedUsers(
		sessionToken: string,
		request?: { limit?: number; pagination_key?: string }
	): Promise<
		APIResponse<{ blocked: unknown[]; next_pagination_key?: string }>
	> {
		const response = await this.request.post("/hub/connections/list-blocked", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request || {},
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body,
		};
	}
}
