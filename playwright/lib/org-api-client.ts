import { APIRequestContext } from "@playwright/test";
import type {
	AssignRoleRequest,
	RemoveRoleRequest,
} from "vetchium-specs/common/roles";
import type {
	GetTagRequest,
	FilterTagsRequest,
	FilterTagsResponse,
	Tag,
} from "vetchium-specs/org/tags";
import type {
	AddCostCenterRequest,
	UpdateCostCenterRequest,
	ListCostCentersRequest,
	ListCostCentersResponse,
	CostCenter,
} from "vetchium-specs/org/cost-centers";
import type {
	CreateAddressRequest,
	UpdateAddressRequest,
	DisableAddressRequest,
	EnableAddressRequest,
	GetAddressRequest,
	ListAddressesRequest,
	ListAddressesResponse,
	OrgAddress,
} from "vetchium-specs/org/company-addresses";
import type {
	OrgInitSignupRequest,
	OrgInitSignupResponse,
	OrgGetSignupDetailsRequest,
	OrgGetSignupDetailsResponse,
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
	OrgSetLanguageRequest,
} from "vetchium-specs/org/org-users";
import type {
	ClaimDomainRequest,
	ClaimDomainResponse,
	VerifyDomainRequest,
	VerifyDomainResponse,
	GetDomainStatusRequest,
	GetDomainStatusResponse,
	ListDomainStatusRequest,
	ListDomainStatusResponse,
	SetPrimaryDomainRequest,
	DeleteDomainRequest,
} from "vetchium-specs/org-domains/org-domains";
import type {
	FilterAuditLogsRequest,
	FilterAuditLogsResponse,
} from "vetchium-specs/audit-logs/audit-logs";
import type {
	CreateSubOrgRequest,
	ListSubOrgsRequest,
	ListSubOrgsResponse,
	SubOrg,
	RenameSubOrgRequest,
	DisableSubOrgRequest,
	EnableSubOrgRequest,
	AddSubOrgMemberRequest,
	RemoveSubOrgMemberRequest,
	ListSubOrgMembersRequest,
	ListSubOrgMembersResponse,
} from "vetchium-specs/org/suborgs";
import type {
	OrgPlan,
	ListPlansResponse,
	UpgradeOrgPlanRequest,
} from "vetchium-specs/org/tiers";
import type {
	MarketplaceCapability,
	ListCapabilitiesResponse,
	MarketplaceListing,
	CreateListingRequest,
	UpdateListingRequest,
	GetListingRequest,
	ListMyListingsRequest,
	ListMyListingsResponse,
	PublishListingRequest,
	ArchiveListingRequest,
	ReopenListingRequest,
	AddListingCapabilityRequest,
	RemoveListingCapabilityRequest,
	DiscoverListingsRequest,
	DiscoverListingsResponse,
	MarketplaceSubscription,
	SubscribeRequest,
	CancelSubscriptionRequest,
	GetSubscriptionRequest,
	ListMySubscriptionsRequest,
	ListMySubscriptionsResponse,
	ListMyClientsRequest,
	ListMyClientsResponse,
} from "vetchium-specs/org/marketplace";
import type {
	CreateOpeningRequest,
	CreateOpeningResponse,
	ListOpeningsRequest,
	ListOpeningsResponse,
	Opening,
	OpeningNumberRequest,
	UpdateOpeningRequest,
	RejectOpeningRequest,
} from "vetchium-specs/org/openings";
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
	 * POST /org/get-signup-details
	 * Gets domain being verified for a signup token
	 */
	async getSignupDetails(
		request: OrgGetSignupDetailsRequest
	): Promise<APIResponse<OrgGetSignupDetailsResponse>> {
		const response = await this.request.post("/org/get-signup-details", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgGetSignupDetailsResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /org/get-signup-details with raw body for testing invalid payloads
	 */
	async getSignupDetailsRaw(
		body: unknown
	): Promise<APIResponse<OrgGetSignupDetailsResponse>> {
		const response = await this.request.post("/org/get-signup-details", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgGetSignupDetailsResponse,
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

	/**
	 * POST /org/list-domains
	 * Lists domains claimed by the org
	 */
	async listDomains(
		sessionToken: string,
		request: ListDomainStatusRequest
	): Promise<APIResponse<ListDomainStatusResponse>> {
		const response = await this.request.post("/org/list-domains", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ListDomainStatusResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /org/list-domains with raw body for testing invalid payloads
	 */
	async listDomainsRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<ListDomainStatusResponse>> {
		const response = await this.request.post("/org/list-domains", {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
			},
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as ListDomainStatusResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /org/list-domains without Authorization header (for testing 401)
	 */
	async listDomainsWithoutAuth(
		request: ListDomainStatusRequest
	): Promise<APIResponse<ListDomainStatusResponse>> {
		const response = await this.request.post("/org/list-domains", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ListDomainStatusResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /org/set-primary-domain
	 */
	async setPrimaryDomain(
		sessionToken: string,
		request: SetPrimaryDomainRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/set-primary-domain", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		return { status: response.status(), body: undefined };
	}

	async setPrimaryDomainRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/set-primary-domain", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		return { status: response.status(), body: undefined };
	}

	async setPrimaryDomainWithoutAuth(
		request: SetPrimaryDomainRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/set-primary-domain", {
			data: request,
		});
		return { status: response.status(), body: undefined };
	}

	/**
	 * POST /org/delete-domain
	 */
	async deleteDomain(
		sessionToken: string,
		request: DeleteDomainRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/delete-domain", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		return { status: response.status(), body: undefined };
	}

	async deleteDomainRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/delete-domain", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		return { status: response.status(), body: undefined };
	}

	async deleteDomainWithoutAuth(
		request: DeleteDomainRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/delete-domain", {
			data: request,
		});
		return { status: response.status(), body: undefined };
	}

	// ============================================================================
	// Login / TFA / Logout
	// ============================================================================

	/**
	 * POST /org/login
	 * Initiates org user login with email, domain, and password.
	 * On success, returns a TFA token and sends TFA code via email.
	 *
	 * @param request - Login request with email, domain, and password
	 * @returns API response with TFA token on success
	 */
	async login(
		request: OrgLoginRequest
	): Promise<APIResponse<OrgLoginResponse>> {
		const response = await this.request.post("/org/login", {
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
	 * POST /org/login with raw body for testing invalid payloads
	 */
	async loginRaw(body: unknown): Promise<APIResponse<OrgLoginResponse>> {
		const response = await this.request.post("/org/login", {
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
	 * POST /org/tfa
	 * Verifies TFA code and returns session token on success.
	 *
	 * @param request - TFA request with tfa_token, tfa_code, and remember_me
	 * @returns API response with session token on success
	 */
	async verifyTFA(
		request: OrgTFARequest
	): Promise<APIResponse<OrgTFAResponse>> {
		const response = await this.request.post("/org/tfa", {
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
	 * POST /org/tfa with raw body for testing invalid payloads
	 */
	async verifyTFARaw(body: unknown): Promise<APIResponse<OrgTFAResponse>> {
		const response = await this.request.post("/org/tfa", {
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
	 * POST /org/logout
	 * Invalidates the session token via Authorization header.
	 *
	 * @param sessionToken - Session token to invalidate
	 * @returns API response (empty body on success)
	 */
	async logout(sessionToken: string): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/logout", {
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
	 * POST /org/logout without Authorization header (for testing 401)
	 */
	async logoutWithoutAuth(): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/logout", {
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
	 * POST /org/invite-user
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
		const response = await this.request.post("/org/invite-user", {
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
	 * POST /org/invite-user with raw body for testing invalid payloads
	 */
	async inviteUserRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<OrgInviteUserResponse>> {
		const response = await this.request.post("/org/invite-user", {
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
	 * POST /org/invite-user without Authorization header (for testing 401)
	 */
	async inviteUserWithoutAuth(
		request: OrgInviteUserRequest
	): Promise<APIResponse<OrgInviteUserResponse>> {
		const response = await this.request.post("/org/invite-user", {
			data: request,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgInviteUserResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /org/complete-setup
	 * Completes the invited user setup with invitation token, password, and full name.
	 * This endpoint does not require authentication (uses invitation token).
	 *
	 * @param request - Setup request with invitation_token, password, and full_name
	 * @returns API response with success message
	 */
	async completeSetup(
		request: OrgCompleteSetupRequest
	): Promise<APIResponse<OrgCompleteSetupResponse>> {
		const response = await this.request.post("/org/complete-setup", {
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
	 * POST /org/complete-setup with raw body for testing invalid payloads
	 */
	async completeSetupRaw(
		body: unknown
	): Promise<APIResponse<OrgCompleteSetupResponse>> {
		const response = await this.request.post("/org/complete-setup", {
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
	 * POST /org/disable-user
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
		const response = await this.request.post("/org/disable-user", {
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
	 * POST /org/disable-user with raw body for testing invalid payloads
	 */
	async disableUserRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/disable-user", {
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
	 * POST /org/enable-user
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
		const response = await this.request.post("/org/enable-user", {
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
	 * POST /org/enable-user with raw body for testing invalid payloads
	 */
	async enableUserRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/enable-user", {
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
	 * POST /org/request-password-reset
	 * Requests a password reset for an org user.
	 * Always returns 200 to prevent email enumeration.
	 *
	 * @param request - Password reset request with email_address and domain
	 * @returns API response with generic success message
	 */
	async requestPasswordReset(
		request: OrgRequestPasswordResetRequest
	): Promise<APIResponse<OrgRequestPasswordResetResponse>> {
		const response = await this.request.post("/org/request-password-reset", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgRequestPasswordResetResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /org/request-password-reset with raw body for testing invalid payloads
	 */
	async requestPasswordResetRaw(
		body: unknown
	): Promise<APIResponse<OrgRequestPasswordResetResponse>> {
		const response = await this.request.post("/org/request-password-reset", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgRequestPasswordResetResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /org/complete-password-reset
	 * Completes password reset with reset token and new password.
	 * Invalidates all existing sessions for the user.
	 *
	 * @param request - Complete password reset request with reset_token and new_password
	 * @returns API response (empty body on success)
	 */
	async completePasswordReset(
		request: OrgCompletePasswordResetRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/complete-password-reset", {
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
	 * POST /org/complete-password-reset with raw body for testing invalid payloads
	 */
	async completePasswordResetRaw(body: unknown): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/complete-password-reset", {
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
	 * POST /org/change-password
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
		const response = await this.request.post("/org/change-password", {
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
	 * POST /org/change-password with raw body for testing invalid payloads
	 */
	async changePasswordRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/change-password", {
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
	 * POST /org/assign-role
	 * Assigns a role to an org user
	 */
	async assignRole(
		sessionToken: string,
		request: AssignRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/org/assign-role", {
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
	 * POST /org/assign-role with raw body for testing invalid payloads
	 */
	async assignRoleRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/org/assign-role", {
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
	 * POST /org/assign-role without authorization header (for testing 401)
	 */
	async assignRoleWithoutAuth(
		request: AssignRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/org/assign-role", {
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
	 * POST /org/remove-role
	 * Removes a role from an org user
	 */
	async removeRole(
		sessionToken: string,
		request: RemoveRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/org/remove-role", {
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
	 * POST /org/remove-role with raw body for testing invalid payloads
	 */
	async removeRoleRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/org/remove-role", {
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
	 * POST /org/remove-role without authorization header (for testing 401)
	 */
	async removeRoleWithoutAuth(
		request: RemoveRoleRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/org/remove-role", {
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
	 * POST /org/list-users
	 * Filters org users.
	 */
	async listUsers(
		sessionToken: string,
		request: import("vetchium-specs/org/org-users").ListOrgUsersRequest
	): Promise<
		APIResponse<import("vetchium-specs/org/org-users").ListOrgUsersResponse>
	> {
		const response = await this.request.post("/org/list-users", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as import("vetchium-specs/org/org-users").ListOrgUsersResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	// ============================================================================
	// Language
	// ============================================================================

	/**
	 * POST /org/set-language
	 * Sets the preferred language for the authenticated user.
	 */
	async setLanguage(
		sessionToken: string,
		request: import("vetchium-specs/org/org-users").OrgSetLanguageRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/org/set-language", {
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
	 * POST /org/set-language with raw body for testing invalid payloads
	 */
	async setLanguageRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/org/set-language", {
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
	 * POST /org/set-language without authorization header (for testing 401)
	 */
	async setLanguageWithoutAuth(
		request: import("vetchium-specs/org/org-users").OrgSetLanguageRequest
	): Promise<APIResponse<{ message: string }>> {
		const response = await this.request.post("/org/set-language", {
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
	 * GET /org/myinfo
	 * Gets current org user information including roles.
	 */
	async getMyInfo(
		sessionToken: string
	): Promise<APIResponse<OrgMyInfoResponse>> {
		const response = await this.request.get("/org/myinfo", {
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
	 * GET /org/myinfo without auth for testing
	 */
	async getMyInfoWithoutAuth(): Promise<APIResponse<OrgMyInfoResponse>> {
		const response = await this.request.get("/org/myinfo");

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgMyInfoResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /org/get-tag
	 * Gets a tag by ID for the given locale
	 */
	async getTag(
		sessionToken: string,
		request: GetTagRequest
	): Promise<APIResponse<Tag>> {
		const response = await this.request.post("/org/get-tag", {
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
	 * POST /org/list-tags
	 * Filters tags by query with pagination
	 */
	async listTags(
		sessionToken: string,
		request: FilterTagsRequest
	): Promise<APIResponse<FilterTagsResponse>> {
		const response = await this.request.post("/org/list-tags", {
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
	// Cost Centers
	// ============================================================================

	/**
	 * POST /org/create-cost-center
	 * Adds a new cost center for the org.
	 */
	async addCostCenter(
		sessionToken: string,
		request: AddCostCenterRequest
	): Promise<APIResponse<CostCenter>> {
		const response = await this.request.post("/org/create-cost-center", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as CostCenter,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /org/create-cost-center with raw body for testing invalid payloads
	 */
	async addCostCenterRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<CostCenter>> {
		const response = await this.request.post("/org/create-cost-center", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as CostCenter,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /org/update-cost-center
	 * Updates an existing cost center.
	 */
	async updateCostCenter(
		sessionToken: string,
		request: UpdateCostCenterRequest
	): Promise<APIResponse<CostCenter>> {
		const response = await this.request.post("/org/update-cost-center", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as CostCenter,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /org/update-cost-center with raw body for testing invalid payloads
	 */
	async updateCostCenterRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<CostCenter>> {
		const response = await this.request.post("/org/update-cost-center", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as CostCenter,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /org/list-cost-centers
	 * Lists cost centers for the org.
	 */
	async listCostCenters(
		sessionToken: string,
		request: ListCostCentersRequest
	): Promise<APIResponse<ListCostCentersResponse>> {
		const response = await this.request.post("/org/list-cost-centers", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ListCostCentersResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /org/list-cost-centers with raw body for testing invalid payloads
	 */
	async listCostCentersRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<ListCostCentersResponse>> {
		const response = await this.request.post("/org/list-cost-centers", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as ListCostCentersResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	// ============================================================================
	// Company Addresses
	// ============================================================================

	/**
	 * POST /org/create-address
	 * Creates a new company address.
	 */
	async createAddress(
		sessionToken: string,
		request: CreateAddressRequest
	): Promise<APIResponse<OrgAddress>> {
		const response = await this.request.post("/org/create-address", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgAddress,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /org/create-address with raw body for testing invalid payloads
	 */
	async createAddressRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<OrgAddress>> {
		const response = await this.request.post("/org/create-address", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgAddress,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /org/update-address
	 * Updates an existing company address.
	 */
	async updateAddress(
		sessionToken: string,
		request: UpdateAddressRequest
	): Promise<APIResponse<OrgAddress>> {
		const response = await this.request.post("/org/update-address", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgAddress,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /org/update-address with raw body for testing invalid payloads
	 */
	async updateAddressRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<OrgAddress>> {
		const response = await this.request.post("/org/update-address", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgAddress,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /org/disable-address
	 * Disables a company address.
	 */
	async disableAddress(
		sessionToken: string,
		request: DisableAddressRequest
	): Promise<APIResponse<OrgAddress>> {
		const response = await this.request.post("/org/disable-address", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgAddress,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /org/disable-address with raw body for testing invalid payloads
	 */
	async disableAddressRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<OrgAddress>> {
		const response = await this.request.post("/org/disable-address", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgAddress,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /org/enable-address
	 * Enables a company address.
	 */
	async enableAddress(
		sessionToken: string,
		request: EnableAddressRequest
	): Promise<APIResponse<OrgAddress>> {
		const response = await this.request.post("/org/enable-address", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgAddress,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /org/enable-address with raw body for testing invalid payloads
	 */
	async enableAddressRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<OrgAddress>> {
		const response = await this.request.post("/org/enable-address", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgAddress,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /org/get-address
	 * Gets a single company address by ID.
	 */
	async getAddress(
		sessionToken: string,
		request: GetAddressRequest
	): Promise<APIResponse<OrgAddress>> {
		const response = await this.request.post("/org/get-address", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgAddress,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /org/get-address with raw body for testing invalid payloads
	 */
	async getAddressRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<OrgAddress>> {
		const response = await this.request.post("/org/get-address", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgAddress,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	/**
	 * POST /org/list-addresses
	 * Lists company addresses for the org.
	 */
	async listAddresses(
		sessionToken: string,
		request: ListAddressesRequest
	): Promise<APIResponse<ListAddressesResponse>> {
		const response = await this.request.post("/org/list-addresses", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ListAddressesResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	/**
	 * POST /org/list-addresses with raw body for testing invalid payloads
	 */
	async listAddressesRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<ListAddressesResponse>> {
		const response = await this.request.post("/org/list-addresses", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as ListAddressesResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	// ============================================================================
	// Audit Logs
	// ============================================================================

	/**
	 * POST /org/list-audit-logs
	 * Filters org portal audit logs scoped to the caller's org.
	 * Requires org:view_audit_logs or org:superadmin role.
	 */
	async listAuditLogs(
		sessionToken: string,
		request: FilterAuditLogsRequest
	): Promise<APIResponse<FilterAuditLogsResponse>> {
		const response = await this.request.post("/org/list-audit-logs", {
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
	 * POST /org/list-audit-logs with raw body for testing invalid payloads
	 */
	async listAuditLogsRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<FilterAuditLogsResponse>> {
		const response = await this.request.post("/org/list-audit-logs", {
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
	 * POST /org/list-audit-logs without Authorization header (for testing 401)
	 */
	async listAuditLogsWithoutAuth(
		request: FilterAuditLogsRequest
	): Promise<APIResponse<FilterAuditLogsResponse>> {
		const response = await this.request.post("/org/list-audit-logs", {
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
	// SubOrgs
	// ============================================================================

	async createSubOrg(
		sessionToken: string,
		request: CreateSubOrgRequest
	): Promise<APIResponse<SubOrg>> {
		const response = await this.request.post("/org/create-suborg", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as SubOrg,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async createSubOrgRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<SubOrg>> {
		const response = await this.request.post("/org/create-suborg", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as SubOrg,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async listSubOrgs(
		sessionToken: string,
		request: ListSubOrgsRequest
	): Promise<APIResponse<ListSubOrgsResponse>> {
		const response = await this.request.post("/org/list-suborgs", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ListSubOrgsResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async listSubOrgsRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<ListSubOrgsResponse>> {
		const response = await this.request.post("/org/list-suborgs", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as ListSubOrgsResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async renameSubOrg(
		sessionToken: string,
		request: RenameSubOrgRequest
	): Promise<APIResponse<SubOrg>> {
		const response = await this.request.post("/org/rename-suborg", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as SubOrg,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async renameSubOrgRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<SubOrg>> {
		const response = await this.request.post("/org/rename-suborg", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as SubOrg,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async disableSubOrg(
		sessionToken: string,
		request: DisableSubOrgRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/disable-suborg", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		return { status: response.status(), body: undefined };
	}

	async disableSubOrgRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/disable-suborg", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		return { status: response.status(), body: undefined };
	}

	async enableSubOrg(
		sessionToken: string,
		request: EnableSubOrgRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/enable-suborg", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		return { status: response.status(), body: undefined };
	}

	async enableSubOrgRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/enable-suborg", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		return { status: response.status(), body: undefined };
	}

	async addSubOrgMember(
		sessionToken: string,
		request: AddSubOrgMemberRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/add-suborg-member", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		return { status: response.status(), body: undefined };
	}

	async addSubOrgMemberRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/add-suborg-member", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		return { status: response.status(), body: undefined };
	}

	async removeSubOrgMember(
		sessionToken: string,
		request: RemoveSubOrgMemberRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/remove-suborg-member", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		return { status: response.status(), body: undefined };
	}

	async removeSubOrgMemberRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/remove-suborg-member", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		return { status: response.status(), body: undefined };
	}

	async listSubOrgMembers(
		sessionToken: string,
		request: ListSubOrgMembersRequest
	): Promise<APIResponse<ListSubOrgMembersResponse>> {
		const response = await this.request.post("/org/list-suborg-members", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ListSubOrgMembersResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async listSubOrgMembersRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<ListSubOrgMembersResponse>> {
		const response = await this.request.post("/org/list-suborg-members", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as ListSubOrgMembersResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async listPlans(
		sessionToken: string
	): Promise<APIResponse<ListPlansResponse>> {
		const response = await this.request.post("/org/list-plans", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: {},
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ListPlansResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async getMyOrgPlan(sessionToken: string): Promise<APIResponse<OrgPlan>> {
		const response = await this.request.post("/org/get-plan", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: {},
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgPlan,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async upgradeOrgPlan(
		sessionToken: string,
		request: UpgradeOrgPlanRequest
	): Promise<APIResponse<OrgPlan>> {
		const response = await this.request.post("/org/upgrade-plan", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as OrgPlan,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async upgradeOrgPlanRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<OrgPlan>> {
		const response = await this.request.post("/org/upgrade-plan", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as OrgPlan,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	// ============================================================================
	// Marketplace — Capabilities
	// ============================================================================

	async listMarketplaceCapabilities(
		sessionToken: string
	): Promise<APIResponse<ListCapabilitiesResponse>> {
		const response = await this.request.post(
			"/org/marketplace/list-capabilities",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: {},
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ListCapabilitiesResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	// ============================================================================
	// Marketplace — Listings
	// ============================================================================

	async createListing(
		sessionToken: string,
		request: CreateListingRequest
	): Promise<APIResponse<MarketplaceListing>> {
		const response = await this.request.post(
			"/org/marketplace/create-listing",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as MarketplaceListing,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async createListingRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<MarketplaceListing>> {
		const response = await this.request.post(
			"/org/marketplace/create-listing",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: body,
			}
		);
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as MarketplaceListing,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async updateListing(
		sessionToken: string,
		request: UpdateListingRequest
	): Promise<APIResponse<MarketplaceListing>> {
		const response = await this.request.post(
			"/org/marketplace/update-listing",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as MarketplaceListing,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async updateListingRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<MarketplaceListing>> {
		const response = await this.request.post(
			"/org/marketplace/update-listing",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: body,
			}
		);
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as MarketplaceListing,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async getListing(
		sessionToken: string,
		request: GetListingRequest
	): Promise<APIResponse<MarketplaceListing>> {
		const response = await this.request.post("/org/marketplace/get-listing", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as MarketplaceListing,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async listMyListings(
		sessionToken: string,
		request: ListMyListingsRequest
	): Promise<APIResponse<ListMyListingsResponse>> {
		const response = await this.request.post("/org/marketplace/list-listings", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ListMyListingsResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async listMyListingsRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<ListMyListingsResponse>> {
		const response = await this.request.post("/org/marketplace/list-listings", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as ListMyListingsResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async publishListing(
		sessionToken: string,
		request: PublishListingRequest
	): Promise<APIResponse<MarketplaceListing>> {
		const response = await this.request.post(
			"/org/marketplace/publish-listing",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as MarketplaceListing,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async publishListingRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<MarketplaceListing>> {
		const response = await this.request.post(
			"/org/marketplace/publish-listing",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: body,
			}
		);
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as MarketplaceListing,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async approveListing(
		sessionToken: string,
		request: GetListingRequest
	): Promise<APIResponse<MarketplaceListing>> {
		const response = await this.request.post(
			"/org/marketplace/approve-listing",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as MarketplaceListing,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async rejectListing(
		sessionToken: string,
		request: GetListingRequest & { rejection_note: string }
	): Promise<APIResponse<MarketplaceListing>> {
		const response = await this.request.post(
			"/org/marketplace/reject-listing",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as MarketplaceListing,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async archiveListing(
		sessionToken: string,
		request: ArchiveListingRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post(
			"/org/marketplace/archive-listing",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		return { status: response.status(), body: undefined };
	}

	async reopenListing(
		sessionToken: string,
		request: ReopenListingRequest
	): Promise<APIResponse<MarketplaceListing>> {
		const response = await this.request.post(
			"/org/marketplace/reopen-listing",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as MarketplaceListing,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async addListingCapability(
		sessionToken: string,
		request: AddListingCapabilityRequest
	): Promise<APIResponse<MarketplaceListing>> {
		const response = await this.request.post(
			"/org/marketplace/add-listing-capability",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as MarketplaceListing,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async removeListingCapability(
		sessionToken: string,
		request: RemoveListingCapabilityRequest
	): Promise<APIResponse<MarketplaceListing>> {
		const response = await this.request.post(
			"/org/marketplace/remove-listing-capability",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as MarketplaceListing,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	// ============================================================================
	// Marketplace — Discovery
	// ============================================================================

	async discoverListings(
		sessionToken: string,
		request: DiscoverListingsRequest
	): Promise<APIResponse<DiscoverListingsResponse>> {
		const response = await this.request.post("/org/marketplace/discover", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as DiscoverListingsResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async discoverListingsRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<DiscoverListingsResponse>> {
		const response = await this.request.post("/org/marketplace/discover", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as DiscoverListingsResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	// ============================================================================
	// Marketplace — Subscriptions (Consumer)
	// ============================================================================

	async subscribe(
		sessionToken: string,
		request: SubscribeRequest
	): Promise<APIResponse<MarketplaceSubscription>> {
		const response = await this.request.post(
			"/org/marketplace/create-subscription",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as MarketplaceSubscription,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async subscribeRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<MarketplaceSubscription>> {
		const response = await this.request.post(
			"/org/marketplace/create-subscription",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: body,
			}
		);
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as MarketplaceSubscription,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async cancelSubscription(
		sessionToken: string,
		request: CancelSubscriptionRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post(
			"/org/marketplace/cancel-subscription",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		return { status: response.status(), body: undefined };
	}

	async cancelSubscriptionRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<void>> {
		const response = await this.request.post(
			"/org/marketplace/cancel-subscription",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: body,
			}
		);
		return { status: response.status(), body: undefined };
	}

	async getSubscription(
		sessionToken: string,
		request: GetSubscriptionRequest
	): Promise<APIResponse<MarketplaceSubscription>> {
		const response = await this.request.post(
			"/org/marketplace/get-subscription",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as MarketplaceSubscription,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async listMySubscriptions(
		sessionToken: string,
		request: ListMySubscriptionsRequest
	): Promise<APIResponse<ListMySubscriptionsResponse>> {
		const response = await this.request.post(
			"/org/marketplace/list-subscriptions",
			{
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: request,
			}
		);
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ListMySubscriptionsResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	// ============================================================================
	// Marketplace — Clients (Provider)
	// ============================================================================

	async listMyClients(
		sessionToken: string,
		request: ListMyClientsRequest
	): Promise<APIResponse<ListMyClientsResponse>> {
		const response = await this.request.post("/org/marketplace/list-clients", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ListMyClientsResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	// ============================================================================
	// Job Openings
	// ============================================================================

	async createOpening(
		sessionToken: string,
		request: CreateOpeningRequest
	): Promise<APIResponse<CreateOpeningResponse>> {
		const response = await this.request.post("/org/create-opening", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as CreateOpeningResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async createOpeningRaw(
		sessionToken: string,
		body: unknown
	): Promise<APIResponse<CreateOpeningResponse>> {
		const response = await this.request.post("/org/create-opening", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as CreateOpeningResponse,
			errors: Array.isArray(responseBody) ? responseBody : undefined,
		};
	}

	async listOpenings(
		sessionToken: string,
		request: ListOpeningsRequest
	): Promise<APIResponse<ListOpeningsResponse>> {
		const response = await this.request.post("/org/list-openings", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as ListOpeningsResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async getOpening(
		sessionToken: string,
		request: OpeningNumberRequest
	): Promise<APIResponse<Opening>> {
		const response = await this.request.post("/org/get-opening", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as Opening,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async updateOpening(
		sessionToken: string,
		request: UpdateOpeningRequest
	): Promise<APIResponse<Opening>> {
		const response = await this.request.post("/org/update-opening", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as Opening,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async submitOpening(
		sessionToken: string,
		request: OpeningNumberRequest
	): Promise<APIResponse<Opening>> {
		const response = await this.request.post("/org/submit-opening", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as Opening,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async approveOpening(
		sessionToken: string,
		request: OpeningNumberRequest
	): Promise<APIResponse<Opening>> {
		const response = await this.request.post("/org/approve-opening", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as Opening,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async rejectOpening(
		sessionToken: string,
		request: RejectOpeningRequest
	): Promise<APIResponse<Opening>> {
		const response = await this.request.post("/org/reject-opening", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as Opening,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async pauseOpening(
		sessionToken: string,
		request: OpeningNumberRequest
	): Promise<APIResponse<Opening>> {
		const response = await this.request.post("/org/pause-opening", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as Opening,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async reopenOpening(
		sessionToken: string,
		request: OpeningNumberRequest
	): Promise<APIResponse<Opening>> {
		const response = await this.request.post("/org/reopen-opening", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as Opening,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async closeOpening(
		sessionToken: string,
		request: OpeningNumberRequest
	): Promise<APIResponse<Opening>> {
		const response = await this.request.post("/org/close-opening", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as Opening,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async archiveOpening(
		sessionToken: string,
		request: OpeningNumberRequest
	): Promise<APIResponse<Opening>> {
		const response = await this.request.post("/org/archive-opening", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as Opening,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}

	async discardOpening(
		sessionToken: string,
		request: OpeningNumberRequest
	): Promise<APIResponse<void>> {
		const response = await this.request.post("/org/discard-opening", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		return { status: response.status(), body: undefined as unknown as void };
	}

	async duplicateOpening(
		sessionToken: string,
		request: OpeningNumberRequest
	): Promise<APIResponse<CreateOpeningResponse>> {
		const response = await this.request.post("/org/duplicate-opening", {
			headers: { Authorization: `Bearer ${sessionToken}` },
			data: request,
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as CreateOpeningResponse,
			errors: Array.isArray(body) ? body : body.errors,
		};
	}
}
