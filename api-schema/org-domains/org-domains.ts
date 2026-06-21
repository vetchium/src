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

// Domain lifecycle duration constants.
export const VERIFICATION_TOKEN_TTL = 7; // days
export const PERIODIC_REVERIFICATION_CYCLE = 60; // days
export const MANUAL_VERIFICATION_COOLDOWN = 60; // minutes
export const FAILURE_THRESHOLD = 3;
export const PRIMARY_FAILOVER_GRACE = 3; // days
export const DOMAIN_RELEASE_COOLDOWN = 30; // days

// Deprecated aliases kept for callers not yet migrated.
export const TOKEN_EXPIRY_DAYS = VERIFICATION_TOKEN_TTL;
export const VERIFICATION_INTERVAL_DAYS = PERIODIC_REVERIFICATION_CYCLE;
export const MAX_CONSECUTIVE_FAILURES = FAILURE_THRESHOLD;
export const VERIFICATION_COOLDOWN_MINUTES = MANUAL_VERIFICATION_COOLDOWN;
/** @deprecated Use PRIMARY_FAILOVER_GRACE */
export const GRACE_PERIOD_DAYS = 14;

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

/** Returned (HTTP 409) when a domain is still in its DomainReleaseCooldown quarantine. */
export interface ClaimDomainCooldownResponse {
	error: string;
	claimable_after: string;
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
	is_primary: boolean;
	verification_token?: DomainVerificationToken;
	expires_at?: string;
	last_verified_at?: string;
	/** Set when status is FAILING; marks when the failure streak began. */
	failing_since?: string;
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
	is_primary: boolean;
	verification_token?: DomainVerificationToken;
	expires_at?: string;
	last_verified_at?: string;
	failing_since?: string;
	can_request_verification: boolean;
	last_attempted_at?: string;
	next_verification_allowed_at?: string;
}

export interface ListDomainStatusResponse {
	domain_statuses: ListDomainStatusItem[];
	next_pagination_key?: string;
}

// ============================================
// Set Primary Domain
// ============================================

export interface SetPrimaryDomainRequest {
	domain: DomainName;
}

export function validateSetPrimaryDomainRequest(
	request: SetPrimaryDomainRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.domain) {
		errs.push(newValidationError("domain", ERR_REQUIRED));
	}

	return errs;
}

// ============================================
// Delete (Unclaim) Domain
// ============================================

export interface DeleteDomainRequest {
	domain: DomainName;
}

export function validateDeleteDomainRequest(
	request: DeleteDomainRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.domain) {
		errs.push(newValidationError("domain", ERR_REQUIRED));
	}

	return errs;
}
