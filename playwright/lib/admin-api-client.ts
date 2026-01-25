import { APIRequestContext } from "@playwright/test";
import {
	AdminLoginRequest,
	AdminLoginResponse,
	AdminTFARequest,
	AdminTFAResponse,
	AdminSetLanguageRequest,
	AdminDisableUserRequest,
	AdminEnableUserRequest,
	AdminRequestPasswordResetRequest,
	AdminRequestPasswordResetResponse,
	AdminCompletePasswordResetRequest,
	AdminChangePasswordRequest,
	AdminInviteUserRequest,
	AdminInviteUserResponse,
	AssignRoleRequest,
	RemoveRoleRequest,
} from "vetchium-specs/admin/admin-users";
import type {
	AddApprovedDomainRequest,
	ListApprovedDomainsRequest,
	GetApprovedDomainRequest,
	DisableApprovedDomainRequest,
	EnableApprovedDomainRequest,
	ApprovedDomainListResponse,
	ApprovedDomainDetailResponse,
} from "vetchium-specs/admin/approved-domains";
import type { APIResponse } from "./api-client";

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
	async login(
		request: AdminLoginRequest
	): Promise<APIResponse<AdminLoginResponse>> {
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
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /admin/tfa
	 * Verifies TFA code and returns session token on success.
	 *
	 * @param request - TFA request with tfa_token and tfa_code
	 * @returns API response with session token on success
	 */
	async verifyTFA(
		request: AdminTFARequest
	): Promise<APIResponse<AdminTFAResponse>> {
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
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /admin/logout
	 * Invalidates the session token via Authorization header.
	 *
	 * @param sessionToken - Session token to invalidate
	 * @returns API response (empty body on success)
	 */
	async logout(sessionToken: string): Promise<APIResponse<void>> {
		const response = await this.request.post("/admin/logout", {
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
	 * POST /admin/logout with raw body for testing invalid payloads
	 * Note: Session token must still be in header for auth
	 */
	async logoutRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/admin/logout", {
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
	 * POST /admin/logout without Authorization header (for testing 401)
	 */
	async logoutWithoutAuth(body: unknown = {}): Promise<APIResponse<void>> {
		const response = await this.request.post("/admin/logout", {
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
	 * POST /admin/set-language with Authorization header
	 */
	async setLanguage(
		sessionToken: string,
		request: AdminSetLanguageRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/admin/set-language", {
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
	 * POST /admin/set-language with raw body for testing invalid payloads
	 */
	async setLanguageRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/admin/set-language", {
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
			errors: Array.isArray(responseBody) ? responseBody : undefined,
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
			data: request
				? { ...request, filter: request.filter || "active" }
				: { filter: "active" },
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
			errors: Array.isArray(responseBody) ? responseBody : undefined,
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
			errors: Array.isArray(responseBody) ? responseBody : undefined,
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
			errors: Array.isArray(responseBody) ? responseBody : undefined,
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
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	// ============================================================================
	// User Management API
	// ============================================================================

	/**
	 * POST /admin/disable-user
	 * Disables an admin user.
	 *
	 * @param sessionToken - Session token for authentication
	 * @param request - Request with target_user_id
	 * @returns API response (200 on success)
	 */
	async disableUser(
		sessionToken: string,
		request: AdminDisableUserRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/admin/disable-user", {
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
	 * POST /admin/disable-user with raw body for testing invalid payloads
	 */
	async disableUserRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/admin/disable-user", {
			headers: { Authorization: `Bearer ${sessionToken}` },
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
	 * POST /admin/enable-user
	 * Re-enables a disabled admin user.
	 *
	 * @param sessionToken - Session token for authentication
	 * @param request - Request with target_user_id
	 * @returns API response (200 on success)
	 */
	async enableUser(
		sessionToken: string,
		request: AdminEnableUserRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/admin/enable-user", {
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
	 * POST /admin/enable-user with raw body for testing invalid payloads
	 */
	async enableUserRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/admin/enable-user", {
			headers: { Authorization: `Bearer ${sessionToken}` },
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
	 * POST /admin/request-password-reset
	 * Requests a password reset for the given email address.
	 * Always returns 200 to prevent email enumeration.
	 *
	 * @param request - Password reset request with email address
	 * @returns API response with generic message
	 */
	async requestPasswordReset(
		request: AdminRequestPasswordResetRequest
	): Promise<APIResponse<AdminRequestPasswordResetResponse>> {
		const response = await this.request.post("/admin/request-password-reset", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as AdminRequestPasswordResetResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /admin/request-password-reset with raw body for testing invalid payloads
	 */
	async requestPasswordResetRaw(
		body: unknown
	): Promise<APIResponse<AdminRequestPasswordResetResponse>> {
		const response = await this.request.post("/admin/request-password-reset", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as AdminRequestPasswordResetResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /admin/complete-password-reset
	 * Completes the password reset using the reset token.
	 *
	 * @param request - Password reset completion request
	 * @returns API response (empty body on success)
	 */
	async completePasswordReset(
		request: AdminCompletePasswordResetRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/admin/complete-password-reset", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: undefined,
			errors: Array.isArray(body) ? body : undefined,
		};
	}

	/**
	 * POST /admin/complete-password-reset with raw body for testing invalid payloads
	 */
	async completePasswordResetRaw(body: unknown): Promise<APIResponse<void>> {
		const response = await this.request.post("/admin/complete-password-reset", {
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
	 * POST /admin/change-password
	 * Changes the password for the authenticated admin user.
	 *
	 * @param sessionToken - Valid session token
	 * @param request - Password change request
	 * @returns API response (empty body on success)
	 */
	async changePassword(
		sessionToken: string,
		request: AdminChangePasswordRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/admin/change-password", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: undefined,
			errors: Array.isArray(body) ? body : undefined,
		};
	}

	/**
	 * POST /admin/change-password with raw body for testing invalid payloads
	 */
	async changePasswordRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/admin/change-password", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: undefined,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	// ============================================================================
	// User Management
	// ============================================================================

	/**
	 * POST /admin/invite-user
	 * Invites a new user to the admin system.
	 *
	 * @param sessionToken - Valid session token
	 * @param request - Invite user request
	 * @returns API response with invitation details
	 */
	async inviteUser(
		sessionToken: string,
		request: AdminInviteUserRequest
	): Promise<APIResponse<AdminInviteUserResponse>> {
		const response = await this.request.post("/admin/invite-user", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as AdminInviteUserResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /admin/invite-user with raw body for testing invalid payloads
	 */
	async inviteUserRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<AdminInviteUserResponse>> {
		const response = await this.request.post("/admin/invite-user", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as AdminInviteUserResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /admin/invite-user without authorization header (for testing 401)
	 */
	async inviteUserWithoutAuth(
		request: AdminInviteUserRequest
	): Promise<APIResponse<AdminInviteUserResponse>> {
		const response = await this.request.post("/admin/invite-user", {
			data: request,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as AdminInviteUserResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	// ============================================================================
	// RBAC (Role-Based Access Control)
	// ============================================================================

	/**
	 * POST /admin/assign-role
	 * Assigns a role to an admin user
	 */
	async assignRole(
		sessionToken: string,
		request: AssignRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/admin/assign-role", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as { message: string },
			errors: body.errors,
		};
	}

	/**
	 * POST /admin/assign-role with raw body for testing invalid payloads
	 */
	async assignRoleRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/admin/assign-role", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as { message: string },
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /admin/assign-role without authorization header (for testing 401)
	 */
	async assignRoleWithoutAuth(
		request: AssignRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/admin/assign-role", {
			data: request,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as { message: string },
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /admin/remove-role
	 * Removes a role from an admin user
	 */
	async removeRole(
		sessionToken: string,
		request: RemoveRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/admin/remove-role", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as { message: string },
			errors: body.errors,
		};
	}

	/**
	 * POST /admin/remove-role with raw body for testing invalid payloads
	 */
	async removeRoleRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/admin/remove-role", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as { message: string },
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /admin/remove-role without authorization header (for testing 401)
	 */
	async removeRoleWithoutAuth(
		request: RemoveRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/admin/remove-role", {
			data: request,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as { message: string },
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}
}
