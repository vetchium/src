import {
	type EmailAddress,
	type Password,
	type DomainName,
	type TFACode,
	type LanguageCode,
	type FullName,
	type ValidationError,
	newValidationError,
	validateEmailAddress,
	validateEmployerEmail,
	validatePassword,
	validateDomainName,
	validateTFACode,
	validateFullName,
	ERR_REQUIRED,
} from "../common/common";

// Token types
export type OrgSessionToken = string;
export type OrgTFAToken = string;
export type DNSVerificationToken = string;
export type OrgSignupToken = string;
export type OrgInvitationToken = string;
export type OrgPasswordResetToken = string;

// ============================================
// Signup Flow (DNS-based Domain Verification)
// ============================================

export interface OrgInitSignupRequest {
	email: EmailAddress;
	home_region: string;
}

export function validateOrgInitSignupRequest(
	request: OrgInitSignupRequest
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

export interface OrgInitSignupResponse {
	domain: DomainName;
	dns_record_name: string;
	token_expires_at: string;
	message: string;
}

export interface OrgGetSignupDetailsRequest {
	signup_token: OrgSignupToken;
}

export function validateOrgGetSignupDetailsRequest(
	request: OrgGetSignupDetailsRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.signup_token) {
		errs.push(newValidationError("signup_token", ERR_REQUIRED));
	}

	return errs;
}

export interface OrgGetSignupDetailsResponse {
	domain: DomainName;
}

export interface OrgCompleteSignupRequest {
	signup_token: OrgSignupToken;
	password: Password;
	preferred_language: LanguageCode;
	has_added_dns_record: boolean;
	agrees_to_eula: boolean;
}

const ERR_DNS_RECORD_NOT_CONFIRMED =
	"You must confirm that you have added the DNS record";
const ERR_EULA_NOT_ACCEPTED =
	"You must agree to the End User License Agreement";

export function validateOrgCompleteSignupRequest(
	request: OrgCompleteSignupRequest
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

export interface OrgCompleteSignupResponse {
	session_token: OrgSessionToken;
	org_user_id: string;
}

// ============================================
// Login Flow
// ============================================

export interface OrgLoginRequest {
	email: EmailAddress;
	domain: DomainName;
	password: Password;
}

export function validateOrgLoginRequest(
	request: OrgLoginRequest
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

export interface OrgLoginResponse {
	tfa_token: OrgTFAToken;
}

export interface OrgTFARequest {
	tfa_token: OrgTFAToken;
	tfa_code: TFACode;
	remember_me: boolean;
}

export function validateOrgTFARequest(
	request: OrgTFARequest
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

export interface OrgTFAResponse {
	session_token: OrgSessionToken;
	preferred_language: LanguageCode;
	employer_name: string;
}

// OrgLogoutRequest is empty - session token passed via Authorization header
export interface OrgLogoutRequest {}

// ============================================
// User Invitation Flow
// ============================================

export interface OrgInviteUserRequest {
	email_address: EmailAddress;
	full_name: FullName;
}

export function validateOrgInviteUserRequest(
	request: OrgInviteUserRequest
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

export interface OrgInviteUserResponse {
	invitation_id: string;
	expires_at: string;
}

export interface OrgCompleteSetupRequest {
	invitation_token: OrgInvitationToken;
	password: Password;
	full_name: FullName;
}

export function validateOrgCompleteSetupRequest(
	request: OrgCompleteSetupRequest
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

export interface OrgCompleteSetupResponse {
	message: string;
}

// ============================================
// User Management (Disable/Enable)
// ============================================

export interface OrgDisableUserRequest {
	target_user_id: string;
}

export function validateOrgDisableUserRequest(
	request: OrgDisableUserRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.target_user_id) {
		errs.push(newValidationError("target_user_id", ERR_REQUIRED));
	}

	return errs;
}

export interface OrgEnableUserRequest {
	target_user_id: string;
}

export function validateOrgEnableUserRequest(
	request: OrgEnableUserRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.target_user_id) {
		errs.push(newValidationError("target_user_id", ERR_REQUIRED));
	}

	return errs;
}

// ============================================================================
// Org Password Management
// ============================================================================

export interface OrgRequestPasswordResetRequest {
	email_address: EmailAddress;
	domain: DomainName;
}

export function validateOrgRequestPasswordResetRequest(
	request: OrgRequestPasswordResetRequest
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

export interface OrgRequestPasswordResetResponse {
	message: string;
}

export interface OrgCompletePasswordResetRequest {
	reset_token: OrgPasswordResetToken;
	new_password: Password;
}

export function validateOrgCompletePasswordResetRequest(
	request: OrgCompletePasswordResetRequest
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

export interface OrgChangePasswordRequest {
	current_password: Password;
	new_password: Password;
}

export function validateOrgChangePasswordRequest(
	request: OrgChangePasswordRequest
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

	// Check if current and new passwords are the same
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
