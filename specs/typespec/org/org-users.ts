import {
	type EmailAddress,
	type Password,
	type DomainName,
	type TFACode,
	type LanguageCode,
	type ValidationError,
	newValidationError,
	validateEmailAddress,
	validateEmployerEmail,
	validatePassword,
	validateDomainName,
	validateTFACode,
	ERR_REQUIRED,
} from "../common/common";

// Token types
export type OrgSignupToken = string;
export type OrgSessionToken = string;
export type OrgTFAToken = string;

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
