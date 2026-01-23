import {
	type EmailAddress,
	type Password,
	type FullName,
	type LanguageCode,
	type TFACode,
	type ValidationError,
	newValidationError,
	validateEmailAddress,
	validatePassword,
	validateFullName,
	validateLanguageCode,
	validateTFACode,
	ERR_REQUIRED,
} from "../common/common";

export type AdminTFAToken = string;
export type AdminSessionToken = string;
export type AdminInvitationToken = string;

export interface AdminLoginRequest {
	email: EmailAddress;
	password: Password;
}

export function validateAdminLoginRequest(
	request: AdminLoginRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	const emailErr = validateEmailAddress(request.email);
	if (emailErr) {
		errs.push(newValidationError("email", emailErr));
	}

	const passwordErr = validatePassword(request.password);
	if (passwordErr) {
		errs.push(newValidationError("password", passwordErr));
	}

	return errs;
}

export interface AdminLoginResponse {
	tfa_token: AdminTFAToken;
}

export interface AdminTFARequest {
	tfa_token: AdminTFAToken;
	tfa_code: TFACode;
}

export function validateAdminTFARequest(
	request: AdminTFARequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.tfa_token) {
		errs.push(newValidationError("tfa_token", ERR_REQUIRED));
	}

	const tfaCodeErr = validateTFACode(request.tfa_code);
	if (tfaCodeErr) {
		errs.push(newValidationError("tfa_code", tfaCodeErr));
	}

	return errs;
}

export interface AdminTFAResponse {
	session_token: AdminSessionToken;
	preferred_language: LanguageCode;
}

export interface AdminLogoutRequest {
	// Empty interface - session token passed in Authorization header
}

export function validateAdminLogoutRequest(
	request: AdminLogoutRequest
): ValidationError[] {
	// No fields to validate
	return [];
}

export interface AdminSetLanguageRequest {
	language: LanguageCode;
}

export function validateAdminSetLanguageRequest(
	request: AdminSetLanguageRequest
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

// ============================================================================
// Admin User Invitation
// ============================================================================

export interface AdminInviteUserRequest {
	email_address: EmailAddress;
	full_name: FullName;
}

export function validateAdminInviteUserRequest(
	request: AdminInviteUserRequest
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

export interface AdminInviteUserResponse {
	invitation_id: string;
	expires_at: string;
}

export interface AdminCompleteSetupRequest {
	invitation_token: AdminInvitationToken;
	password: Password;
	full_name: FullName;
}

export function validateAdminCompleteSetupRequest(
	request: AdminCompleteSetupRequest
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

export interface AdminCompleteSetupResponse {
	message: string;
}

// ============================================================================
// Admin User Management (Disable/Enable)
// ============================================================================

export interface AdminDisableUserRequest {
	target_user_id: string;
}

export function validateAdminDisableUserRequest(
	request: AdminDisableUserRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.target_user_id) {
		errs.push(newValidationError("target_user_id", ERR_REQUIRED));
	}

	return errs;
}

export interface AdminEnableUserRequest {
	target_user_id: string;
}

export function validateAdminEnableUserRequest(
	request: AdminEnableUserRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.target_user_id) {
		errs.push(newValidationError("target_user_id", ERR_REQUIRED));
	}

	return errs;
}
