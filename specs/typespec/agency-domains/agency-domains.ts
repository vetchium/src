import {
	type DomainName,
	type ValidationError,
	newValidationError,
	validateDomainName,
	ERR_REQUIRED,
} from "../common/common";

// Domain Verification Token - secret expected in DNS TXT record
export type AgencyDomainVerificationToken = string;

// Domain verification status enum
export const AgencyDomainVerificationStatus = {
	PENDING: "PENDING",
	VERIFIED: "VERIFIED",
	FAILING: "FAILING",
} as const;

export type AgencyDomainVerificationStatus =
	(typeof AgencyDomainVerificationStatus)[keyof typeof AgencyDomainVerificationStatus];

// Constants for agency domain verification
export const AgencyTokenExpiryDays = 7;
export const AgencyVerificationIntervalDays = 60;
export const AgencyGracePeriodDays = 14;
export const AgencyMaxConsecutiveFailures = 3;
export const AgencyVerificationCooldownMinutes = 60; // Rate limit: 1 hour between verification requests

// ============================================
// Agency Domain Verification Flow
// ============================================

export interface AgencyClaimDomainRequest {
	domain: DomainName;
}

export function validateAgencyClaimDomainRequest(
	request: AgencyClaimDomainRequest
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

export interface AgencyClaimDomainResponse {
	domain: string;
	verification_token: AgencyDomainVerificationToken;
	expires_at: string; // ISO 8601 datetime
	instructions: string;
}

export interface AgencyVerifyDomainRequest {
	domain: DomainName;
}

export function validateAgencyVerifyDomainRequest(
	request: AgencyVerifyDomainRequest
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

export interface AgencyVerifyDomainResponse {
	status: AgencyDomainVerificationStatus;
	verified_at?: string; // ISO 8601 datetime
	message?: string;
}

export interface AgencyGetDomainStatusRequest {
	domain: DomainName;
}

export function validateAgencyGetDomainStatusRequest(
	request: AgencyGetDomainStatusRequest
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

export interface AgencyGetDomainStatusResponse {
	domain: string;
	status: AgencyDomainVerificationStatus;
	verification_token?: AgencyDomainVerificationToken;
	expires_at?: string; // ISO 8601 datetime
	last_verified_at?: string; // ISO 8601 datetime
	can_request_verification: boolean;
	last_attempted_at?: string; // ISO 8601 datetime — when verification was last requested
	next_verification_allowed_at?: string; // ISO 8601 datetime — earliest time next request is allowed (only when !can_request_verification)
}

export interface AgencyListDomainStatusRequest {
	pagination_key?: string;
}

export function validateAgencyListDomainStatusRequest(
	_request: AgencyListDomainStatusRequest
): ValidationError[] {
	return [];
}

export interface AgencyListDomainStatusItem {
	domain: string;
	status: AgencyDomainVerificationStatus;
	verification_token?: AgencyDomainVerificationToken;
	expires_at?: string; // ISO 8601 datetime
	last_verified_at?: string; // ISO 8601 datetime
	can_request_verification: boolean;
	last_attempted_at?: string; // ISO 8601 datetime — when verification was last requested
	next_verification_allowed_at?: string; // ISO 8601 datetime — earliest time next request is allowed (only when !can_request_verification)
}

export interface AgencyListDomainStatusResponse {
	items: AgencyListDomainStatusItem[];
	next_pagination_key?: string;
}
