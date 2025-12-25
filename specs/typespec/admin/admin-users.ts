import {
	type EmailAddress,
	type Password,
	type LanguageCode,
	type ValidationError,
	newValidationError,
	validateEmailAddress,
	validatePassword,
	validateLanguageCode,
	ERR_REQUIRED,
	ERR_TFA_CODE_INVALID_LENGTH,
	ERR_TFA_CODE_INVALID_FORMAT,
} from "../common/common";

export type { EmailAddress, Password, LanguageCode, ValidationError };

export type AdminTFAToken = string;
export type AdminSessionToken = string;
export type TFACode = string;

// Validation constraints matching admin-users.tsp
export const TFA_CODE_LENGTH = 6;
const TFA_CODE_PATTERN = /^[0-9]{6}$/;

// Validates TFA code, returns error message or null (no field context)
export function validateTFACode(code: TFACode): string | null {
	if (code.length !== TFA_CODE_LENGTH) {
		return ERR_TFA_CODE_INVALID_LENGTH;
	}
	if (!TFA_CODE_PATTERN.test(code)) {
		return ERR_TFA_CODE_INVALID_FORMAT;
	}
	return null;
}

export interface AdminLoginRequest {
	email: EmailAddress;
	password: Password;
}

export function validateAdminLoginRequest(
	request: AdminLoginRequest,
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
	request: AdminTFARequest,
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
	session_token: AdminSessionToken;
}

export function validateAdminLogoutRequest(
	request: AdminLogoutRequest,
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.session_token) {
		errs.push(newValidationError("session_token", ERR_REQUIRED));
	}

	return errs;
}

export interface UpdatePreferencesRequest {
	session_token: AdminSessionToken;
	preferred_language: LanguageCode;
}

export function validateUpdatePreferencesRequest(
	request: UpdatePreferencesRequest,
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.session_token) {
		errs.push(newValidationError("session_token", ERR_REQUIRED));
	}

	if (!request.preferred_language) {
		errs.push(newValidationError("preferred_language", ERR_REQUIRED));
	} else {
		const langErr = validateLanguageCode(request.preferred_language);
		if (langErr) {
			errs.push(newValidationError("preferred_language", langErr));
		}
	}

	return errs;
}
