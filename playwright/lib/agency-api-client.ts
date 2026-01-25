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
	AgencyRequestPasswordResetRequest,
	AgencyRequestPasswordResetResponse,
	AgencyCompletePasswordResetRequest,
	AgencyChangePasswordRequest,
	AgencyInviteUserRequest,
	AgencyInviteUserResponse,
	AssignRoleRequest,
	RemoveRoleRequest,
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
			errors: Array.isArray(body) ? body : body.errors,
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
			errors: Array.isArray(body) ? body : body.errors,
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
			errors: Array.isArray(body) ? body : body.errors,
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
			errors: Array.isArray(body) ? body : body.errors,
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
			errors: Array.isArray(body) ? body : body.errors,
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
			errors: Array.isArray(body) ? body : body.errors,
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
	// Password Management
	// ============================================================================

	/**
	 * POST /agency/request-password-reset
	 * Requests a password reset for an agency user.
	 *
	 * @param request - Password reset request with email and domain
	 * @returns API response with generic success message
	 */
	async requestPasswordReset(
		request: AgencyRequestPasswordResetRequest
	): Promise<APIResponse<AgencyRequestPasswordResetResponse>> {
		const response = await this.request.post("/agency/request-password-reset", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as AgencyRequestPasswordResetResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /agency/request-password-reset with raw body for testing invalid payloads
	 */
	async requestPasswordResetRaw(
		body: unknown
	): Promise<APIResponse<AgencyRequestPasswordResetResponse>> {
		const response = await this.request.post("/agency/request-password-reset", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as AgencyRequestPasswordResetResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /agency/complete-password-reset
	 * Completes password reset with token and new password.
	 *
	 * @param request - Complete reset request with reset_token and new_password
	 * @returns API response (empty body on success)
	 */
	async completePasswordReset(
		request: AgencyCompletePasswordResetRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post(
			"/agency/complete-password-reset",
			{
				data: request,
			}
		);

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: undefined,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /agency/complete-password-reset with raw body for testing invalid payloads
	 */
	async completePasswordResetRaw(body: unknown): Promise<APIResponse<void>> {
		const response = await this.request.post(
			"/agency/complete-password-reset",
			{
				data: body,
			}
		);

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: undefined,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /agency/change-password
	 * Changes password for authenticated agency user.
	 *
	 * @param sessionToken - Session token
	 * @param request - Change password request with current and new passwords
	 * @returns API response (empty body on success)
	 */
	async changePassword(
		sessionToken: string,
		request: AgencyChangePasswordRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/agency/change-password", {
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
	 * POST /agency/change-password with raw body for testing invalid payloads
	 */
	async changePasswordRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/agency/change-password", {
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
	// User Invitation
	// ============================================================================

	/**
	 * POST /agency/invite-user
	 * Invites a new user to the agency.
	 *
	 * @param sessionToken - Valid session token
	 * @param request - Invite user request
	 * @returns API response with invitation details
	 */
	async inviteUser(
		sessionToken: string,
		request: AgencyInviteUserRequest
	): Promise<APIResponse<AgencyInviteUserResponse>> {
		const response = await this.request.post("/agency/invite-user", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as AgencyInviteUserResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /agency/invite-user with raw body for testing invalid payloads
	 */
	async inviteUserRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<AgencyInviteUserResponse>> {
		const response = await this.request.post("/agency/invite-user", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as AgencyInviteUserResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /agency/invite-user without authorization header (for testing 401)
	 */
	async inviteUserWithoutAuth(
		request: AgencyInviteUserRequest
	): Promise<APIResponse<AgencyInviteUserResponse>> {
		const response = await this.request.post("/agency/invite-user", {
			data: request,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as AgencyInviteUserResponse,
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
			errors: Array.isArray(body) ? body : body.errors,
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
			errors: Array.isArray(body) ? body : body.errors,
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

	// ============================================================================
	// RBAC (Role-Based Access Control)
	// ============================================================================

	/**
	 * POST /agency/assign-role
	 * Assigns a role to an agency user
	 */
	async assignRole(
		sessionToken: string,
		request: AssignRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/agency/assign-role", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as { message: string },
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /agency/assign-role with raw body for testing invalid payloads
	 */
	async assignRoleRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/agency/assign-role", {
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
	 * POST /agency/assign-role without authorization header (for testing 401)
	 */
	async assignRoleWithoutAuth(
		request: AssignRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/agency/assign-role", {
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
	 * POST /agency/remove-role
	 * Removes a role from an agency user
	 */
	async removeRole(
		sessionToken: string,
		request: RemoveRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/agency/remove-role", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as { message: string },
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /agency/remove-role with raw body for testing invalid payloads
	 */
	async removeRoleRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/agency/remove-role", {
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
	 * POST /agency/remove-role without authorization header (for testing 401)
	 */
	async removeRoleWithoutAuth(
		request: RemoveRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/agency/remove-role", {
			data: request,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as { message: string },
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	// ============================================================================
	// User Filtering
	// ============================================================================

	/**
	 * POST /agency/filter-users
	 * Filters agency users.
	 */
	async filterUsers(
		sessionToken: string,
		request: import("vetchium-specs/agency/agency-users").FilterAgencyUsersRequest
	): Promise<
		APIResponse<
			import("vetchium-specs/agency/agency-users").FilterAgencyUsersResponse
		>
	> {
		const response = await this.request.post("/agency/filter-users", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as import("vetchium-specs/agency/agency-users").FilterAgencyUsersResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}
}
