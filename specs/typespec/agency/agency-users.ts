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
	validateLanguageCode,
	ERR_REQUIRED,
} from "../common/common";
import {
	type RoleName,
	type AssignRoleRequest,
	type RemoveRoleRequest,
	validateAssignRoleRequest,
	validateRemoveRoleRequest,
	validateRoleName,
	ERR_ROLE_NAME_INVALID,
} from "../common/roles";

export { validateAssignRoleRequest, validateRemoveRoleRequest };

// Token types
export type AgencySessionToken = string;
export type AgencyTFAToken = string;
export type DNSVerificationToken = string;
export type AgencySignupToken = string;
export type AgencyInvitationToken = string;
export type AgencyPasswordResetToken = string;

// ... (omitted sections)
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

export interface AgencyGetSignupDetailsRequest {
	signup_token: string;
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

/**
 * Request to complete agency signup after DNS verification.
 * The first user is automatically granted admin rights and assigned
 * both 'agency:invite_users' and 'agency:manage_users' roles.
 * All operations are atomic - either the entire signup succeeds or no data is created.
 */
export interface AgencyCompleteSignupRequest {
	signup_token: string;
	password: Password;
	preferred_language: LanguageCode;
	has_added_dns_record: boolean;
	agrees_to_eula: boolean;
}

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
		const passErr = validatePassword(request.password);
		if (passErr) {
			errs.push(newValidationError("password", passErr));
		}
	}

	if (!request.preferred_language) {
		errs.push(newValidationError("preferred_language", ERR_REQUIRED));
	} else {
		const langErr = validateLanguageCode(request.preferred_language);
		if (langErr) {
			errs.push(newValidationError("preferred_language", langErr));
		}
	}

	if (!request.has_added_dns_record) {
		errs.push(newValidationError("has_added_dns_record", ERR_REQUIRED));
	}

	if (!request.agrees_to_eula) {
		errs.push(newValidationError("agrees_to_eula", ERR_REQUIRED));
	}

	return errs;
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
	}

	return errs;
}

export interface AgencyTFARequest {
	tfa_token: string;
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
const ERR_ROLES_REQUIRED = "at least one role is required";
const ERR_ROLE_WRONG_PORTAL = "role does not belong to the agency portal";

export interface AgencyInviteUserRequest {
	email_address: EmailAddress;
	invite_email_language?: LanguageCode;
	roles: RoleName[];
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

	if (request.invite_email_language) {
		const langErr = validateLanguageCode(request.invite_email_language);
		if (langErr) {
			errs.push(newValidationError("invite_email_language", langErr));
		}
	}

	if (!request.roles || request.roles.length === 0) {
		errs.push(newValidationError("roles", ERR_ROLES_REQUIRED));
	} else {
		for (const role of request.roles) {
			const roleErr = validateRoleName(role);
			if (roleErr) {
				errs.push(newValidationError("roles", ERR_ROLE_NAME_INVALID));
			} else if (!role.startsWith("agency:")) {
				errs.push(newValidationError("roles", ERR_ROLE_WRONG_PORTAL));
			}
		}
	}

	return errs;
}

export interface AgencyInviteUserResponse {
	invitation_id: string;
	expires_at: string;
}

// ===================================
// Complete Setup
// ===================================

export interface AgencyCompleteSetupRequest {
	invitation_token: AgencyInvitationToken;
	password: Password;
	full_name: FullName;
	preferred_language?: LanguageCode;
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

	if (request.preferred_language) {
		const langErr = validateLanguageCode(request.preferred_language);
		if (langErr) {
			errs.push(newValidationError("preferred_language", langErr));
		}
	}

	return errs;
}

export interface AgencyCompleteSetupResponse {
	message: string;
}

// ... (omitted sections)

export interface AgencyUser {
	email_address: EmailAddress;
	name: string;
	status: string;
	created_at: string;
	roles: RoleName[];
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

// ===================================
// Disable/Enable User
// ===================================

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

// ===================================
// Language Management
// ===================================

export interface AgencySetLanguageRequest {
	language: LanguageCode;
}

export function validateAgencySetLanguageRequest(
	request: AgencySetLanguageRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.language) {
		errs.push(newValidationError("language", ERR_REQUIRED));
	} else {
		const langErr = validateLanguageCode(request.language);
		if (langErr) {
			errs.push(newValidationError("language", langErr));
		}
	}

	return errs;
}

// ===================================
// Get Current User Info
// ===================================

export interface AgencyMyInfoResponse {
	agency_user_id: string;
	full_name: string;
	preferred_language: LanguageCode;
	agency_name: string;
	roles: string[];
}
