import {
	type EmailAddress,
	type Password,
	type LanguageCode,
	type TFACode,
	type ValidationError,
	newValidationError,
	validateEmailAddress,
	validatePassword,
	validateLanguageCode,
	validateTFACode,
	ERR_REQUIRED,
} from "../common/common";

export type AdminTFAToken = string;
export type AdminSessionToken = string;

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
