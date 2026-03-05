import { newValidationError, type ValidationError } from "../common/common";

export interface AuditLogEntry {
	id: string;
	event_type: string;
	actor_user_id: string | null;
	target_user_id: string | null;
	org_id: string | null;
	ip_address: string;
	event_data: Record<string, unknown>;
	created_at: string; // ISO 8601
}

export interface FilterAuditLogsRequest {
	event_types?: string[];
	actor_user_id?: string;
	start_time?: string; // ISO 8601
	end_time?: string; // ISO 8601
	pagination_key?: string;
	limit?: number; // 1-100, default 40
}

export interface FilterAuditLogsResponse {
	audit_logs: AuditLogEntry[];
	pagination_key: string | null;
}

export function validateFilterAuditLogsRequest(
	request: FilterAuditLogsRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (request.limit !== undefined) {
		if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100) {
			errs.push(newValidationError("limit", "must be between 1 and 100"));
		}
	}

	if (request.start_time !== undefined) {
		const d = new Date(request.start_time);
		if (isNaN(d.getTime())) {
			errs.push(newValidationError("start_time", "must be a valid ISO 8601 timestamp"));
		}
	}

	if (request.end_time !== undefined) {
		const d = new Date(request.end_time);
		if (isNaN(d.getTime())) {
			errs.push(newValidationError("end_time", "must be a valid ISO 8601 timestamp"));
		}
	}

	return errs;
}
