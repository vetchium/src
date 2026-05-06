import {
	type ValidationError,
	newValidationError,
} from "../common/common";

export interface BlockedPersonalDomain {
	domain: string;
	created_at: string;
}

export interface AdminAddBlockedDomainRequest {
	domain: string;
}

export interface AdminRemoveBlockedDomainRequest {
	domain: string;
}

export interface AdminListBlockedDomainsRequest {
	filter_domain_prefix?: string;
	pagination_key?: string;
	limit?: number;
}

export interface AdminListBlockedDomainsResponse {
	domains: BlockedPersonalDomain[];
	next_pagination_key?: string;
}

// Validation
export const ERR_DOMAIN_REQUIRED = "domain is required";
export const ERR_DOMAIN_TOO_LONG = "domain must be at most 253 characters";
export const ERR_DOMAIN_HAS_AT = "domain must not contain @";

export function validateAdminAddBlockedDomainRequest(
	request: AdminAddBlockedDomainRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!request.domain || request.domain.trim() === "") {
		errs.push(newValidationError("domain", ERR_DOMAIN_REQUIRED));
	} else if (request.domain.length > 253) {
		errs.push(newValidationError("domain", ERR_DOMAIN_TOO_LONG));
	} else if (request.domain.includes("@")) {
		errs.push(newValidationError("domain", ERR_DOMAIN_HAS_AT));
	}
	return errs;
}

export function validateAdminRemoveBlockedDomainRequest(
	request: AdminRemoveBlockedDomainRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!request.domain || request.domain.trim() === "") {
		errs.push(newValidationError("domain", ERR_DOMAIN_REQUIRED));
	}
	return errs;
}

export function validateAdminListBlockedDomainsRequest(
	request: AdminListBlockedDomainsRequest
): ValidationError[] {
	return [];
}
