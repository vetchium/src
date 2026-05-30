import type { Handle } from "./hub-users.js";
import type { ConnectionState } from "./connections.js";

export type EndorsementRequestState =
	| "pending"
	| "written"
	| "declined"
	| "expired";

export interface RequestEndorsementsRequest {
	application_id: string;
	endorser_handles: Handle[];
	note?: string;
}

export interface EndorsementRequestIncoming {
	request_id: string;
	application_id: string;
	candidate_handle: Handle;
	candidate_display_name: string;
	org_domain: string;
	org_name: string;
	opening_title: string;
	shared_domain: string;
	overlap_start_year: number;
	overlap_end_year: number;
	note?: string;
	state: EndorsementRequestState;
	requested_at: string;
	candidate_connection_state: ConnectionState;
}

export interface EndorsementRequestOutgoing {
	request_id: string;
	application_id: string;
	endorser_handle: Handle;
	endorser_display_name: string;
	state: EndorsementRequestState;
	requested_at: string;
}

export interface ListEndorsementRequestsIncomingRequest {
	filter_state?: EndorsementRequestState[];
	pagination_key?: string;
	limit?: number;
}

export interface ListEndorsementRequestsIncomingResponse {
	requests: EndorsementRequestIncoming[];
	next_pagination_key?: string;
}

export interface ListEndorsementRequestsOutgoingRequest {
	application_id: string;
	pagination_key?: string;
	limit?: number;
}

export interface ListEndorsementRequestsOutgoingResponse {
	requests: EndorsementRequestOutgoing[];
	next_pagination_key?: string;
}

export interface WriteEndorsementRequest {
	request_id?: string;
	application_id?: string;
	text: string;
}

export interface WriteEndorsementResponse {
	endorsement_id: string;
}

export interface UpdateEndorsementRequest {
	endorsement_id: string;
	text: string;
}

export interface DeclineEndorsementRequestRequest {
	request_id: string;
}

export interface HideEndorsementOnApplicationRequest {
	endorsement_id: string;
}

export interface ShowEndorsementOnApplicationRequest {
	endorsement_id: string;
}

export interface ValidationError {
	field: string;
	message: string;
}

export function validateRequestEndorsementsRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.application_id !== "string" || r.application_id.trim() === "") {
		errors.push({
			field: "application_id",
			message: "Must be a non-empty string",
		});
	}

	if (!Array.isArray(r.endorser_handles)) {
		errors.push({ field: "endorser_handles", message: "Must be an array" });
	} else {
		if (r.endorser_handles.length < 1 || r.endorser_handles.length > 10) {
			errors.push({
				field: "endorser_handles",
				message: "Must have 1-10 items",
			});
		}
		for (const h of r.endorser_handles) {
			if (typeof h !== "string" || h.trim() === "") {
				errors.push({
					field: "endorser_handles",
					message: "All handles must be non-empty strings",
				});
				break;
			}
		}
	}

	if (r.note !== undefined) {
		if (typeof r.note !== "string") {
			errors.push({ field: "note", message: "Must be a string" });
		} else if (r.note.length > 500) {
			errors.push({
				field: "note",
				message: "Must be at most 500 characters",
			});
		}
	}

	return errors;
}

export function validateListEndorsementRequestsIncomingRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (r.limit !== undefined) {
		if (typeof r.limit !== "number" || r.limit < 1 || r.limit > 100) {
			errors.push({ field: "limit", message: "Must be between 1 and 100" });
		}
	}

	if (r.pagination_key !== undefined && typeof r.pagination_key !== "string") {
		errors.push({ field: "pagination_key", message: "Must be a string" });
	}

	return errors;
}

export function validateListEndorsementRequestsOutgoingRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.application_id !== "string" || r.application_id.trim() === "") {
		errors.push({
			field: "application_id",
			message: "Must be a non-empty string",
		});
	}

	if (r.limit !== undefined) {
		if (typeof r.limit !== "number" || r.limit < 1 || r.limit > 100) {
			errors.push({ field: "limit", message: "Must be between 1 and 100" });
		}
	}

	return errors;
}

export function validateWriteEndorsementRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	const hasRequestId =
		typeof r.request_id === "string" && r.request_id.trim() !== "";
	const hasApplicationId =
		typeof r.application_id === "string" && r.application_id.trim() !== "";

	if (hasRequestId === hasApplicationId) {
		errors.push({
			field: "request_id",
			message: "Exactly one of request_id or application_id must be provided",
		});
	}

	if (typeof r.text !== "string") {
		errors.push({ field: "text", message: "Must be a string" });
	} else if (r.text.length < 100 || r.text.length > 2000) {
		errors.push({
			field: "text",
			message: "Must be between 100 and 2000 characters",
		});
	}

	return errors;
}

export function validateUpdateEndorsementRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.endorsement_id !== "string" || r.endorsement_id.trim() === "") {
		errors.push({
			field: "endorsement_id",
			message: "Must be a non-empty string",
		});
	}

	if (typeof r.text !== "string") {
		errors.push({ field: "text", message: "Must be a string" });
	} else if (r.text.length < 100 || r.text.length > 2000) {
		errors.push({
			field: "text",
			message: "Must be between 100 and 2000 characters",
		});
	}

	return errors;
}

export function validateDeclineEndorsementRequestRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.request_id !== "string" || r.request_id.trim() === "") {
		errors.push({ field: "request_id", message: "Must be a non-empty string" });
	}

	return errors;
}

export function validateHideEndorsementOnApplicationRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.endorsement_id !== "string" || r.endorsement_id.trim() === "") {
		errors.push({
			field: "endorsement_id",
			message: "Must be a non-empty string",
		});
	}

	return errors;
}

export function validateShowEndorsementOnApplicationRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.endorsement_id !== "string" || r.endorsement_id.trim() === "") {
		errors.push({
			field: "endorsement_id",
			message: "Must be a non-empty string",
		});
	}

	return errors;
}
