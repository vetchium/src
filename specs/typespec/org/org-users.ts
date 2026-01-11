import {
	type EmailAddress,
	type Password,
	type ValidationError,
	newValidationError,
	validateEmployerEmail,
	validatePassword,
	ERR_REQUIRED,
} from "../common/common";

// Token types
export type OrgSignupToken = string;
export type OrgSessionToken = string;

// ============================================
// Signup Flow
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
	message: string;
}

export interface OrgCompleteSignupRequest {
	signup_token: OrgSignupToken;
	password: Password;
}

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

	return errs;
}

export interface OrgCompleteSignupResponse {
	session_token: OrgSessionToken;
	org_user_id: string;
}
