import {
	type DomainName,
	type ValidationError,
	newValidationError,
	validateDomainName,
	ERR_REQUIRED,
} from "../common/common";

// Domain Verification Token - secret expected in DNS TXT record
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
export const TokenExpiryDays = 7;
export const VerificationIntervalDays = 60;
export const GracePeriodDays = 14;
export const MaxConsecutiveFailures = 3;
// Rate limit: minimum minutes between verification requests per domain
export const VerificationCooldownMinutes = 60;

// TODO: Add domain_verification_events audit log — see specs/Ideas.md

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
	can_request_verification: boolean;
}

export interface ListDomainStatusRequest {
	pagination_key?: string;
}

export function validateListDomainStatusRequest(
	_request: ListDomainStatusRequest
): ValidationError[] {
	return [];
}

export interface ListDomainStatusItem {
	domain: string;
	status: DomainVerificationStatus;
	verification_token?: DomainVerificationToken;
	expires_at?: string; // ISO 8601 datetime
	last_verified_at?: string; // ISO 8601 datetime
	can_request_verification: boolean;
}

export interface ListDomainStatusResponse {
	items: ListDomainStatusItem[];
	next_pagination_key?: string;
}
