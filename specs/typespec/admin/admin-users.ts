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
import {
	type RoleName,
	type AssignRoleRequest,
	type RemoveRoleRequest,
	validateAssignRoleRequest,
	validateRemoveRoleRequest,
} from "../common/roles";

// Re-export RBAC types for admin portal
export type { RoleName, AssignRoleRequest, RemoveRoleRequest };
export { validateAssignRoleRequest, validateRemoveRoleRequest };

export type AdminTFAToken = string;
export type AdminSessionToken = string;
export type AdminInvitationToken = string;
export type AdminPasswordResetToken = string;

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
	email_address: EmailAddress;
}

export function validateAdminDisableUserRequest(
	request: AdminDisableUserRequest
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

export interface AdminEnableUserRequest {
	email_address: EmailAddress;
}

export function validateAdminEnableUserRequest(
	request: AdminEnableUserRequest
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
// Admin Password Management
// ============================================================================

export interface AdminRequestPasswordResetRequest {
	email_address: EmailAddress;
}

export function validateAdminRequestPasswordResetRequest(
	request: AdminRequestPasswordResetRequest
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

export interface AdminRequestPasswordResetResponse {
	message: string;
}

export interface AdminCompletePasswordResetRequest {
	reset_token: AdminPasswordResetToken;
	new_password: Password;
}

export function validateAdminCompletePasswordResetRequest(
	request: AdminCompletePasswordResetRequest
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

export interface AdminChangePasswordRequest {
	current_password: Password;
	new_password: Password;
}

export function validateAdminChangePasswordRequest(
	request: AdminChangePasswordRequest
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

// ============================================================================
// User Management (Filter Users)
// ============================================================================

export interface AdminUser {
	email_address: EmailAddress;
	name: string;
	status: string;
	created_at: string;
}

export interface FilterAdminUsersRequest {
	limit?: number;
	cursor?: string;
	filter_email?: string;
	filter_name?: string;
	filter_status?: string;
}

export function validateFilterAdminUsersRequest(
	request: FilterAdminUsersRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	return errs;
}

export interface FilterAdminUsersResponse {
	items: AdminUser[];
	next_cursor: string;
}
