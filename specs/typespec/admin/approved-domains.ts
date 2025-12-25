import {
	type EmailAddress,
	type DomainName,
	type ValidationError,
	newValidationError,
	validateDomainName,
	ERR_REQUIRED,
} from "../common/common";

export type { EmailAddress, DomainName, ValidationError };

export type AuditAction = "created" | "deleted";

export interface CreateApprovedDomainRequest {
	domain_name: DomainName;
}

export function validateCreateApprovedDomainRequest(
	request: CreateApprovedDomainRequest,
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

	return errs;
}

export interface ApprovedDomain {
	domain_name: DomainName;
	created_by_admin_email: EmailAddress;
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

export interface AuditLogsResponse {
	logs: ApprovedDomainAuditLog[];
	next_cursor: string;
	has_more: boolean;
}
