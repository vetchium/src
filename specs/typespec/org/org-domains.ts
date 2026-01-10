import {
	type EmailAddress,
	type Password,
	type DomainName,
	type ValidationError,
	newValidationError,
	validateEmailAddress,
	validatePassword,
	validateDomainName,
	ERR_REQUIRED,
} from "../common/common";

// Token types
export type OrgSignupToken = string;
export type OrgSessionToken = string;
export type DomainVerificationToken = string;

// Domain verification status enum
export const DomainVerificationStatus = {
	PENDING: "PENDING",
	VERIFIED: "VERIFIED",
	FAILING: "FAILING",
} as const;

export type DomainVerificationStatus =
	(typeof DomainVerificationStatus)[keyof typeof DomainVerificationStatus];

// Constants for domain verification
export const TOKEN_EXPIRY_DAYS = 7;
export const VERIFICATION_INTERVAL_DAYS = 60;
export const GRACE_PERIOD_DAYS = 14;
export const MAX_CONSECUTIVE_FAILURES = 3;

// ============================================
// Signup Flow
// ============================================

export interface OrgInitSignupRequest {
	email: EmailAddress;
}

export function validateOrgInitSignupRequest(
	request: OrgInitSignupRequest
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
// Domain Verification Flow
// ============================================

export interface ClaimDomainRequest {
	domain: DomainName;
}

export function validateClaimDomainRequest(
	request: ClaimDomainRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

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

export interface ClaimDomainResponse {
	domain: string;
	verification_token: DomainVerificationToken;
	expires_at: string; // ISO 8601 datetime
	instructions: string;
}

export interface VerifyDomainRequest {
	domain: DomainName;
}

export function validateVerifyDomainRequest(
	request: VerifyDomainRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

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

export interface VerifyDomainResponse {
	status: DomainVerificationStatus;
	verified_at?: string; // ISO 8601 datetime
	message?: string;
}

export interface GetDomainStatusRequest {
	domain: DomainName;
}

export function validateGetDomainStatusRequest(
	request: GetDomainStatusRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

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

export interface GetDomainStatusResponse {
	domain: string;
	status: DomainVerificationStatus;
	verification_token?: DomainVerificationToken;
	expires_at?: string; // ISO 8601 datetime
	last_verified_at?: string; // ISO 8601 datetime
}
