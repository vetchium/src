import {
	type DomainName,
	type ValidationError,
	newValidationError,
	ERR_REQUIRED,
} from "../common/common";

// Domain Verification Token - secret expected in DNS TXT record
export type DomainVerificationToken = string;

// Domain verification status enum
export type DomainVerificationStatus = "PENDING" | "VERIFIED" | "FAILING";

export const DomainVerificationStatusPending: DomainVerificationStatus =
	"PENDING";
export const DomainVerificationStatusVerified: DomainVerificationStatus =
	"VERIFIED";
export const DomainVerificationStatusFailing: DomainVerificationStatus =
	"FAILING";

// Constants for domain verification
export const TOKEN_EXPIRY_DAYS = 7;
export const VERIFICATION_INTERVAL_DAYS = 60;
export const GRACE_PERIOD_DAYS = 14;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const VERIFICATION_COOLDOWN_MINUTES = 60; // Rate limit: 1 hour between verification requests

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
	}

	return errs;
}

export interface ClaimDomainResponse {
	domain: string;
	verification_token: DomainVerificationToken;
	expires_at: string;
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
	}

	return errs;
}

export interface VerifyDomainResponse {
	status: DomainVerificationStatus;
	verified_at?: string;
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
	}

	return errs;
}

export interface GetDomainStatusResponse {
	domain: string;
	status: DomainVerificationStatus;
	verification_token?: DomainVerificationToken;
	expires_at?: string;
	last_verified_at?: string;
	can_request_verification: boolean;
	last_attempted_at?: string;
	next_verification_allowed_at?: string;
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
	expires_at?: string;
	last_verified_at?: string;
	can_request_verification: boolean;
	last_attempted_at?: string;
	next_verification_allowed_at?: string;
}

export interface ListDomainStatusResponse {
	items: ListDomainStatusItem[];
	next_pagination_key?: string;
}
