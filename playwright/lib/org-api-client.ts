import { APIRequestContext } from "@playwright/test";
import type {
	AssignRoleRequest,
	RemoveRoleRequest,
} from "vetchium-specs/common/roles";
import type {
	OrgInitSignupRequest,
	OrgInitSignupResponse,
	OrgCompleteSignupRequest,
	OrgCompleteSignupResponse,
	OrgLoginRequest,
	OrgLoginResponse,
	OrgTFARequest,
	OrgTFAResponse,
	OrgInviteUserRequest,
	OrgInviteUserResponse,
	OrgCompleteSetupRequest,
	OrgCompleteSetupResponse,
	OrgDisableUserRequest,
	OrgEnableUserRequest,
	OrgRequestPasswordResetRequest,
	OrgRequestPasswordResetResponse,
	OrgCompletePasswordResetRequest,
	OrgChangePasswordRequest,
	OrgMyInfoResponse,
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
			errors: Array.isArray(body) ? body : body.errors,
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
			errors: Array.isArray(body) ? body : body.errors,
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
			errors: Array.isArray(body) ? body : body.errors,
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
			errors: Array.isArray(body) ? body : body.errors,
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
			errors: Array.isArray(body) ? body : body.errors,
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
			errors: Array.isArray(body) ? body : body.errors,
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
			errors: Array.isArray(body) ? body : body.errors,
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
			errors: Array.isArray(body) ? body : body.errors,
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
	async login(
		request: OrgLoginRequest
	): Promise<APIResponse<OrgLoginResponse>> {
		const response = await this.request.post("/employer/login", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgLoginResponse,
			errors: Array.isArray(body) ? body : body.errors,
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
	async verifyTFA(
		request: OrgTFARequest
	): Promise<APIResponse<OrgTFAResponse>> {
		const response = await this.request.post("/employer/tfa", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgTFAResponse,
			errors: Array.isArray(body) ? body : body.errors,
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
			errors: Array.isArray(body) ? body : body.errors,
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

	// ============================================================================
	// User Invitation
	// ============================================================================

	/**
	 * POST /employer/invite-user
	 * Invites a new user to the organization.
	 * Requires authentication and admin privileges.
	 *
	 * @param sessionToken - Session token of the inviter
	 * @param request - Invitation request with email_address and full_name
	 * @returns API response with invitation_id and expires_at on success
	 */
	async inviteUser(
		sessionToken: string,
		request: OrgInviteUserRequest
	): Promise<APIResponse<OrgInviteUserResponse>> {
		const response = await this.request.post("/employer/invite-user", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgInviteUserResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /employer/invite-user with raw body for testing invalid payloads
	 */
	async inviteUserRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<OrgInviteUserResponse>> {
		const response = await this.request.post("/employer/invite-user", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgInviteUserResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /employer/invite-user without Authorization header (for testing 401)
	 */
	async inviteUserWithoutAuth(
		request: OrgInviteUserRequest
	): Promise<APIResponse<OrgInviteUserResponse>> {
		const response = await this.request.post("/employer/invite-user", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgInviteUserResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /employer/complete-setup
	 * Completes the invited user setup with invitation token, password, and full name.
	 * This endpoint does not require authentication (uses invitation token).
	 *
	 * @param request - Setup request with invitation_token, password, and full_name
	 * @returns API response with success message
	 */
	async completeSetup(
		request: OrgCompleteSetupRequest
	): Promise<APIResponse<OrgCompleteSetupResponse>> {
		const response = await this.request.post("/employer/complete-setup", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgCompleteSetupResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /employer/complete-setup with raw body for testing invalid payloads
	 */
	async completeSetupRaw(
		body: unknown
	): Promise<APIResponse<OrgCompleteSetupResponse>> {
		const response = await this.request.post("/employer/complete-setup", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgCompleteSetupResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	// ============================================================================
	// User Management (Disable/Enable)
	// ============================================================================

	/**
	 * POST /employer/disable-user
	 * Disables a user in the organization.
	 * Requires authentication and admin privileges.
	 *
	 * @param sessionToken - Session token of the admin
	 * @param request - Disable request with target_user_id
	 * @returns API response (empty body on success)
	 */
	async disableUser(
		sessionToken: string,
		request: OrgDisableUserRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/employer/disable-user", {
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
	 * POST /employer/disable-user with raw body for testing invalid payloads
	 */
	async disableUserRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/employer/disable-user", {
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
	 * POST /employer/enable-user
	 * Enables a previously disabled user in the organization.
	 * Requires authentication and admin privileges.
	 *
	 * @param sessionToken - Session token of the admin
	 * @param request - Enable request with target_user_id
	 * @returns API response (empty body on success)
	 */
	async enableUser(
		sessionToken: string,
		request: OrgEnableUserRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/employer/enable-user", {
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
	 * POST /employer/enable-user with raw body for testing invalid payloads
	 */
	async enableUserRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/employer/enable-user", {
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
	// Password Management
	// ============================================================================

	/**
	 * POST /employer/request-password-reset
	 * Requests a password reset for an org user.
	 * Always returns 200 to prevent email enumeration.
	 *
	 * @param request - Password reset request with email_address and domain
	 * @returns API response with generic success message
	 */
	async requestPasswordReset(
		request: OrgRequestPasswordResetRequest
	): Promise<APIResponse<OrgRequestPasswordResetResponse>> {
		const response = await this.request.post(
			"/employer/request-password-reset",
			{
				data: request,
			}
		);

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgRequestPasswordResetResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /employer/request-password-reset with raw body for testing invalid payloads
	 */
	async requestPasswordResetRaw(
		body: unknown
	): Promise<APIResponse<OrgRequestPasswordResetResponse>> {
		const response = await this.request.post(
			"/employer/request-password-reset",
			{
				data: body,
			}
		);

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgRequestPasswordResetResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /employer/complete-password-reset
	 * Completes password reset with reset token and new password.
	 * Invalidates all existing sessions for the user.
	 *
	 * @param request - Complete password reset request with reset_token and new_password
	 * @returns API response (empty body on success)
	 */
	async completePasswordReset(
		request: OrgCompletePasswordResetRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post(
			"/employer/complete-password-reset",
			{
				data: request,
			}
		);

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: undefined,
			errors: Array.isArray(body) ? body : undefined,
		};
	}

	/**
	 * POST /employer/complete-password-reset with raw body for testing invalid payloads
	 */
	async completePasswordResetRaw(body: unknown): Promise<APIResponse<void>> {
		const response = await this.request.post(
			"/employer/complete-password-reset",
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
	 * POST /employer/change-password
	 * Changes password for an authenticated org user.
	 * Invalidates all sessions except the current one.
	 *
	 * @param sessionToken - Session token of the authenticated user
	 * @param request - Change password request with current_password and new_password
	 * @returns API response (empty body on success)
	 */
	async changePassword(
		sessionToken: string,
		request: OrgChangePasswordRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/employer/change-password", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
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
	 * POST /employer/change-password with raw body for testing invalid payloads
	 */
	async changePasswordRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/employer/change-password", {
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
	 * POST /employer/assign-role
	 * Assigns a role to an org user
	 */
	async assignRole(
		sessionToken: string,
		request: AssignRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/employer/assign-role", {
			headers: { Authorization: `Bearer ${sessionToken}`, Cookie: "" },
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
	 * POST /employer/assign-role with raw body for testing invalid payloads
	 */
	async assignRoleRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/employer/assign-role", {
			headers: { Authorization: `Bearer ${sessionToken}`, Cookie: "" },
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
	 * POST /employer/assign-role without authorization header (for testing 401)
	 */
	async assignRoleWithoutAuth(
		request: AssignRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/employer/assign-role", {
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
	 * POST /employer/remove-role
	 * Removes a role from an org user
	 */
	async removeRole(
		sessionToken: string,
		request: RemoveRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/employer/remove-role", {
			headers: { Authorization: `Bearer ${sessionToken}`, Cookie: "" },
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
	 * POST /employer/remove-role with raw body for testing invalid payloads
	 */
	async removeRoleRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/employer/remove-role", {
			headers: { Authorization: `Bearer ${sessionToken}`, Cookie: "" },
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
	 * POST /employer/remove-role without authorization header (for testing 401)
	 */
	/**
	 * POST /employer/remove-role without authorization header (for testing 401)
	 */
	async removeRoleWithoutAuth(
		request: RemoveRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/employer/remove-role", {
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
	 * POST /employer/filter-users
	 * Filters org users.
	 */
	async filterUsers(
		sessionToken: string,
		request: import("vetchium-specs/org/org-users").FilterOrgUsersRequest
	): Promise<
		APIResponse<import("vetchium-specs/org/org-users").FilterOrgUsersResponse>
	> {
		const response = await this.request.post("/employer/filter-users", {
			headers: { Authorization: `Bearer ${sessionToken}`, Cookie: "" },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as import("vetchium-specs/org/org-users").FilterOrgUsersResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	// ============================================================================
	// Language
	// ============================================================================

	/**
	 * POST /employer/set-language
	 * Sets the preferred language for the authenticated user.
	 */
	async setLanguage(
		sessionToken: string,
		request: import("vetchium-specs/org/org-users").OrgSetLanguageRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/employer/set-language", {
			headers: { Authorization: `Bearer ${sessionToken}`, Cookie: "" },
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
	 * POST /employer/set-language with raw body for testing invalid payloads
	 */
	async setLanguageRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/employer/set-language", {
			headers: { Authorization: `Bearer ${sessionToken}`, Cookie: "" },
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
	 * POST /employer/set-language without authorization header (for testing 401)
	 */
	async setLanguageWithoutAuth(
		request: import("vetchium-specs/org/org-users").OrgSetLanguageRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/employer/set-language", {
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
	// User Info
	// ============================================================================

	/**
	 * GET /employer/myinfo
	 * Gets current org user information including roles.
	 */
	async getMyInfo(
		sessionToken: string
	): Promise<APIResponse<OrgMyInfoResponse>> {
		const response = await this.request.get("/employer/myinfo", {
			headers: { Authorization: `Bearer ${sessionToken}` },
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgMyInfoResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * GET /employer/myinfo without auth for testing
	 */
	async getMyInfoWithoutAuth(): Promise<APIResponse<OrgMyInfoResponse>> {
		const response = await this.request.get("/employer/myinfo");

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgMyInfoResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}
}
