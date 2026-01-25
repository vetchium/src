import {
	type EmailAddress,
	type Password,
	type FullName,
	type DomainName,
	type TFACode,
	type LanguageCode,
	type ValidationError,
	newValidationError,
	validateEmailAddress,
	validateEmployerEmail,
	validatePassword,
	validateFullName,
	validateDomainName,
	validateTFACode,
	ERR_REQUIRED,
} from "../common/common";
import {
	type RoleName,
	type AssignRoleRequest,
	type RemoveRoleRequest,
	validateAssignRoleRequest,
	validateRemoveRoleRequest,
} from "../common/roles";

// Re-export RBAC types for agency portal
export type { RoleName, AssignRoleRequest, RemoveRoleRequest };
export { validateAssignRoleRequest, validateRemoveRoleRequest };

// Token types
export type AgencySessionToken = string;
export type AgencyTFAToken = string;
export type AgencyInvitationToken = string;
export type DNSVerificationToken = string;
export type AgencySignupToken = string;
export type AgencyPasswordResetToken = string;

// ============================================
// Signup Flow (DNS-based Domain Verification)
// ============================================

export interface AgencyInitSignupRequest {
	email: EmailAddress;
	home_region: string;
}

export function validateAgencyInitSignupRequest(
	request: AgencyInitSignupRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.email) {
		errs.push(newValidationError("email", ERR_REQUIRED));
	} else {
		// Use employer email validation which blocks personal email domains
		const emailErr = validateEmployerEmail(request.email);
		if (emailErr) {
			errs.push(newValidationError("email", emailErr));
		}
	}

	if (!request.home_region) {
		errs.push(newValidationError("home_region", ERR_REQUIRED));
	}

	return errs;
}

export interface AgencyInitSignupResponse {
	domain: DomainName;
	dns_record_name: string;
	token_expires_at: string;
	message: string;
}

export interface AgencyGetSignupDetailsRequest {
	signup_token: AgencySignupToken;
}

export function validateAgencyGetSignupDetailsRequest(
	request: AgencyGetSignupDetailsRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.signup_token) {
		errs.push(newValidationError("signup_token", ERR_REQUIRED));
	}

	return errs;
}

export interface AgencyGetSignupDetailsResponse {
	domain: DomainName;
}

export interface AgencyCompleteSignupRequest {
	signup_token: AgencySignupToken;
	password: Password;
	preferred_language: LanguageCode;
	has_added_dns_record: boolean;
	agrees_to_eula: boolean;
}

const ERR_DNS_RECORD_NOT_CONFIRMED =
	"You must confirm that you have added the DNS record";
const ERR_EULA_NOT_ACCEPTED =
	"You must agree to the End User License Agreement";

export function validateAgencyCompleteSignupRequest(
	request: AgencyCompleteSignupRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.signup_token) {
		errs.push(newValidationError("signup_token", ERR_REQUIRED));
	}

	if (!request.password) {
		errs.push(newValidationError("password", ERR_REQUIRED));
	} else {
		const passwordErr = validatePassword(request.password);
		if (passwordErr) {
			errs.push(newValidationError("password", passwordErr));
		}
	}

	if (!request.preferred_language) {
		errs.push(newValidationError("preferred_language", ERR_REQUIRED));
	}

	if (!request.has_added_dns_record) {
		errs.push(
			newValidationError("has_added_dns_record", ERR_DNS_RECORD_NOT_CONFIRMED)
		);
	}

	if (!request.agrees_to_eula) {
		errs.push(newValidationError("agrees_to_eula", ERR_EULA_NOT_ACCEPTED));
	}

	return errs;
}

export interface AgencyCompleteSignupResponse {
	session_token: AgencySessionToken;
	agency_user_id: string;
}

// ============================================
// Login Flow
// ============================================

export interface AgencyLoginRequest {
	email: EmailAddress;
	domain: DomainName;
	password: Password;
}

export function validateAgencyLoginRequest(
	request: AgencyLoginRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.email) {
		errs.push(newValidationError("email", ERR_REQUIRED));
	} else {
		const emailErr = validateEmailAddress(request.email);
		if (emailErr) {
			errs.push(newValidationError("email", emailErr));
		}
	}

	if (!request.domain) {
		errs.push(newValidationError("domain", ERR_REQUIRED));
	} else {
		const domainErr = validateDomainName(request.domain);
		if (domainErr) {
			errs.push(newValidationError("domain", domainErr));
		}
	}

	if (!request.password) {
		errs.push(newValidationError("password", ERR_REQUIRED));
	} else {
		const passwordErr = validatePassword(request.password);
		if (passwordErr) {
			errs.push(newValidationError("password", passwordErr));
		}
	}

	return errs;
}

export interface AgencyLoginResponse {
	tfa_token: AgencyTFAToken;
}

export interface AgencyTFARequest {
	tfa_token: AgencyTFAToken;
	tfa_code: TFACode;
	remember_me: boolean;
}

export function validateAgencyTFARequest(
	request: AgencyTFARequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.tfa_token) {
		errs.push(newValidationError("tfa_token", ERR_REQUIRED));
	}

	if (!request.tfa_code) {
		errs.push(newValidationError("tfa_code", ERR_REQUIRED));
	} else {
		const tfaErr = validateTFACode(request.tfa_code);
		if (tfaErr) {
			errs.push(newValidationError("tfa_code", tfaErr));
		}
	}

	return errs;
}

export interface AgencyTFAResponse {
	session_token: AgencySessionToken;
	preferred_language: LanguageCode;
	agency_name: string;
}

// AgencyLogoutRequest is empty - session token passed via Authorization header
export interface AgencyLogoutRequest {}

// ============================================================================
// Agency User Invitation
// ============================================================================

export interface AgencyInviteUserRequest {
	email_address: EmailAddress;
	full_name: FullName;
}

export function validateAgencyInviteUserRequest(
	request: AgencyInviteUserRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.email_address) {
		errs.push(newValidationError("email_address", ERR_REQUIRED));
	} else {
		const emailErr = validateEmailAddress(request.email_address);
		if (emailErr) {
			errs.push(newValidationError("email_address", emailErr));
		}
	}

	if (!request.full_name) {
		errs.push(newValidationError("full_name", ERR_REQUIRED));
	} else {
		const fullNameErr = validateFullName(request.full_name);
		if (fullNameErr) {
			errs.push(newValidationError("full_name", fullNameErr));
		}
	}

	return errs;
}

export interface AgencyInviteUserResponse {
	invitation_id: string;
	expires_at: string;
}

export interface AgencyCompleteSetupRequest {
	invitation_token: AgencyInvitationToken;
	password: Password;
	full_name: FullName;
}

export function validateAgencyCompleteSetupRequest(
	request: AgencyCompleteSetupRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.invitation_token) {
		errs.push(newValidationError("invitation_token", ERR_REQUIRED));
	}

	if (!request.password) {
		errs.push(newValidationError("password", ERR_REQUIRED));
	} else {
		const passwordErr = validatePassword(request.password);
		if (passwordErr) {
			errs.push(newValidationError("password", passwordErr));
		}
	}

	if (!request.full_name) {
		errs.push(newValidationError("full_name", ERR_REQUIRED));
	} else {
		const fullNameErr = validateFullName(request.full_name);
		if (fullNameErr) {
			errs.push(newValidationError("full_name", fullNameErr));
		}
	}

	return errs;
}

export interface AgencyCompleteSetupResponse {
	message: string;
}

// ============================================================================
// Agency User Management (Disable/Enable)
// ============================================================================

export interface AgencyDisableUserRequest {
	email_address: EmailAddress;
}

export function validateAgencyDisableUserRequest(
	request: AgencyDisableUserRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.email_address) {
		errs.push(newValidationError("email_address", ERR_REQUIRED));
	} else {
		const emailErr = validateEmailAddress(request.email_address);
		if (emailErr) {
			errs.push(newValidationError("email_address", emailErr));
		}
	}

	return errs;
}

export interface AgencyEnableUserRequest {
	email_address: EmailAddress;
}

export function validateAgencyEnableUserRequest(
	request: AgencyEnableUserRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.email_address) {
		errs.push(newValidationError("email_address", ERR_REQUIRED));
	} else {
		const emailErr = validateEmailAddress(request.email_address);
		if (emailErr) {
			errs.push(newValidationError("email_address", emailErr));
		}
	}

	return errs;
}

// ============================================================================
// Agency Password Management
// ============================================================================

export interface AgencyRequestPasswordResetRequest {
	email_address: EmailAddress;
	domain: DomainName;
}

export function validateAgencyRequestPasswordResetRequest(
	request: AgencyRequestPasswordResetRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.email_address) {
		errs.push(newValidationError("email_address", ERR_REQUIRED));
	} else {
		const emailErr = validateEmailAddress(request.email_address);
		if (emailErr) {
			errs.push(newValidationError("email_address", emailErr));
		}
	}

	if (!request.domain) {
		errs.push(newValidationError("domain", ERR_REQUIRED));
	} else {
		const domainErr = validateDomainName(request.domain);
		if (domainErr) {
			errs.push(newValidationError("domain", domainErr));
		}
	}

	return errs;
}

export interface AgencyRequestPasswordResetResponse {
	message: string;
}

export interface AgencyCompletePasswordResetRequest {
	reset_token: AgencyPasswordResetToken;
	new_password: Password;
}

export function validateAgencyCompletePasswordResetRequest(
	request: AgencyCompletePasswordResetRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.reset_token) {
		errs.push(newValidationError("reset_token", ERR_REQUIRED));
	}

	if (!request.new_password) {
		errs.push(newValidationError("new_password", ERR_REQUIRED));
	} else {
		const passwordErr = validatePassword(request.new_password);
		if (passwordErr) {
			errs.push(newValidationError("new_password", passwordErr));
		}
	}

	return errs;
}

export interface AgencyChangePasswordRequest {
	current_password: Password;
	new_password: Password;
}

export function validateAgencyChangePasswordRequest(
	request: AgencyChangePasswordRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.current_password) {
		errs.push(newValidationError("current_password", ERR_REQUIRED));
	} else {
		const currentPasswordErr = validatePassword(request.current_password);
		if (currentPasswordErr) {
			errs.push(newValidationError("current_password", currentPasswordErr));
		}
	}

	if (!request.new_password) {
		errs.push(newValidationError("new_password", ERR_REQUIRED));
	} else {
		const newPasswordErr = validatePassword(request.new_password);
		if (newPasswordErr) {
			errs.push(newValidationError("new_password", newPasswordErr));
		}
	}

	if (
		request.current_password &&
		request.new_password &&
		request.current_password === request.new_password
	) {
		errs.push(
			newValidationError(
				"new_password",
				"New password must be different from current password"
			)
		);
	}

	return errs;
}

// ============================================================================
// User Management (Filter Users)
// ============================================================================

export interface AgencyUser {
	email_address: EmailAddress;
	name: string;
	status: string;
	created_at: string;
}

export interface FilterAgencyUsersRequest {
	limit?: number;
	cursor?: string;
	filter_email?: string;
	filter_name?: string;
	filter_status?: string;
}

export function validateFilterAgencyUsersRequest(
	request: FilterAgencyUsersRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	// Optional fields, default validation
	return errs;
}

export interface FilterAgencyUsersResponse {
	items: AgencyUser[];
	next_cursor: string;
}
