import {
	type EmailAddress,
	type DomainName,
	type ValidationError,
	newValidationError,
	validateDomainName,
	ERR_REQUIRED,
} from "../common/common";

export type { EmailAddress, DomainName, ValidationError };

export type DomainStatus = "active" | "inactive";

export type DomainFilter = "active" | "inactive" | "all";

export type AuditAction = "created" | "disabled" | "enabled";

// Error messages
const ERR_REASON_TOO_LONG = "Reason must be 256 characters or less";
const ERR_REASON_REQUIRED = "Reason is required";
const ERR_INVALID_FILTER = "Filter must be 'active', 'inactive', or 'all'";

export interface AddApprovedDomainRequest {
	domain_name: DomainName;
	reason: string;
}

export function validateAddApprovedDomainRequest(
	request: AddApprovedDomainRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.domain_name) {
		errs.push(newValidationError("domain_name", ERR_REQUIRED));
	} else {
		const domainErr = validateDomainName(request.domain_name);
		if (domainErr) {
			errs.push(newValidationError("domain_name", domainErr));
		}
	}

	if (!request.reason) {
		errs.push(newValidationError("reason", ERR_REASON_REQUIRED));
	} else if (request.reason.length > 256) {
		errs.push(newValidationError("reason", ERR_REASON_TOO_LONG));
	}

	return errs;
}

export interface ListApprovedDomainsRequest {
	search?: string;
	filter?: DomainFilter;
	limit?: number;
	cursor?: string;
}

export function validateListApprovedDomainsRequest(
	request: ListApprovedDomainsRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (
		request.filter &&
		!["active", "inactive", "all"].includes(request.filter)
	) {
		errs.push(newValidationError("filter", ERR_INVALID_FILTER));
	}

	if (request.limit !== undefined) {
		if (typeof request.limit !== "number" || request.limit <= 0) {
			errs.push(newValidationError("limit", "Limit must be a positive number"));
		} else if (request.limit > 100) {
			errs.push(newValidationError("limit", "Limit cannot exceed 100"));
		}
	}

	return errs;
}

export interface GetApprovedDomainRequest {
	domain_name: DomainName;
	audit_cursor?: string;
	audit_limit?: number;
}

export function validateGetApprovedDomainRequest(
	request: GetApprovedDomainRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.domain_name) {
		errs.push(newValidationError("domain_name", ERR_REQUIRED));
	} else {
		const domainErr = validateDomainName(request.domain_name);
		if (domainErr) {
			errs.push(newValidationError("domain_name", domainErr));
		}
	}

	if (request.audit_limit !== undefined) {
		if (typeof request.audit_limit !== "number" || request.audit_limit <= 0) {
			errs.push(
				newValidationError(
					"audit_limit",
					"Audit limit must be a positive number"
				)
			);
		} else if (request.audit_limit > 100) {
			errs.push(
				newValidationError("audit_limit", "Audit limit cannot exceed 100")
			);
		}
	}

	return errs;
}

export interface DisableApprovedDomainRequest {
	domain_name: DomainName;
	reason: string;
}

export function validateDisableApprovedDomainRequest(
	request: DisableApprovedDomainRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.domain_name) {
		errs.push(newValidationError("domain_name", ERR_REQUIRED));
	} else {
		const domainErr = validateDomainName(request.domain_name);
		if (domainErr) {
			errs.push(newValidationError("domain_name", domainErr));
		}
	}

	if (!request.reason) {
		errs.push(newValidationError("reason", ERR_REASON_REQUIRED));
	} else if (request.reason.length > 256) {
		errs.push(newValidationError("reason", ERR_REASON_TOO_LONG));
	}

	return errs;
}

export interface EnableApprovedDomainRequest {
	domain_name: DomainName;
	reason: string;
}

export function validateEnableApprovedDomainRequest(
	request: EnableApprovedDomainRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.domain_name) {
		errs.push(newValidationError("domain_name", ERR_REQUIRED));
	} else {
		const domainErr = validateDomainName(request.domain_name);
		if (domainErr) {
			errs.push(newValidationError("domain_name", domainErr));
		}
	}

	if (!request.reason) {
		errs.push(newValidationError("reason", ERR_REASON_REQUIRED));
	} else if (request.reason.length > 256) {
		errs.push(newValidationError("reason", ERR_REASON_TOO_LONG));
	}

	return errs;
}

export interface ApprovedDomain {
	domain_name: DomainName;
	created_by_admin_email: EmailAddress;
	status: DomainStatus;
	created_at: string;
	updated_at: string;
}

export interface ApprovedDomainListResponse {
	domains: ApprovedDomain[];
	next_cursor: string;
	has_more: boolean;
}

export interface ApprovedDomainAuditLog {
	admin_email: EmailAddress;
	action: AuditAction;
	target_domain_name?: DomainName;
	reason?: string;
	old_value?: Record<string, unknown>;
	new_value?: Record<string, unknown>;
	ip_address?: string;
	user_agent?: string;
	request_id?: string;
	created_at: string;
}

export interface ApprovedDomainDetailResponse {
	domain: ApprovedDomain;
	audit_logs: ApprovedDomainAuditLog[];
	next_audit_cursor: string;
	has_more_audit: boolean;
}
