import type { Handle } from "./hub-users.js";

export type ReferenceNominationState =
	| "nominated"
	| "accepted"
	| "declined"
	| "submitted"
	| "expired";

export type ReferenceInboxRequestKind = "to_nominate" | "to_respond";

export interface ReferenceQuestion {
	question_id: string;
	text: string;
	min_chars: number;
	max_chars: number;
	required: boolean;
}

export interface HubReferenceRequestSummary {
	kind: ReferenceInboxRequestKind;
	request_id: string;
	nomination_id?: string;
	org_domain: string;
	org_name: string;
	opening_title: string;
	candidate_handle?: Handle;
	max_references?: number;
	questions: ReferenceQuestion[];
	response_deadline: string;
	state?: ReferenceNominationState;
	created_at: string;
}

export interface ListReferenceRequestsIncomingRequest {
	filter_kind?: ReferenceInboxRequestKind[];
	filter_state?: ReferenceNominationState[];
	pagination_key?: string;
	limit?: number;
}

export interface ListReferenceRequestsIncomingResponse {
	requests: HubReferenceRequestSummary[];
	next_pagination_key?: string;
}

export interface NominateReferencesRequest {
	request_id: string;
	nominee_handles: Handle[];
}

export interface AcceptReferenceNominationRequest {
	nomination_id: string;
}

export interface DeclineReferenceNominationRequest {
	nomination_id: string;
}

export interface SubmitReferenceResponseRequest {
	nomination_id: string;
	answers: Array<{
		question_id: string;
		response_text: string;
	}>;
}

export interface ValidationError {
	field: string;
	message: string;
}

export function validateListReferenceRequestsIncomingRequest(
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

export function validateNominateReferencesRequest(
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

	if (!Array.isArray(r.nominee_handles)) {
		errors.push({ field: "nominee_handles", message: "Must be an array" });
	} else {
		if (r.nominee_handles.length < 1 || r.nominee_handles.length > 5) {
			errors.push({
				field: "nominee_handles",
				message: "Must have 1-5 items",
			});
		}
		for (const h of r.nominee_handles) {
			if (typeof h !== "string" || h.trim() === "") {
				errors.push({
					field: "nominee_handles",
					message: "All handles must be non-empty strings",
				});
				break;
			}
		}
	}

	return errors;
}

export function validateAcceptReferenceNominationRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.nomination_id !== "string" || r.nomination_id.trim() === "") {
		errors.push({
			field: "nomination_id",
			message: "Must be a non-empty string",
		});
	}

	return errors;
}

export function validateDeclineReferenceNominationRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.nomination_id !== "string" || r.nomination_id.trim() === "") {
		errors.push({
			field: "nomination_id",
			message: "Must be a non-empty string",
		});
	}

	return errors;
}

export function validateSubmitReferenceResponseRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.nomination_id !== "string" || r.nomination_id.trim() === "") {
		errors.push({
			field: "nomination_id",
			message: "Must be a non-empty string",
		});
	}

	if (!Array.isArray(r.answers)) {
		errors.push({ field: "answers", message: "Must be an array" });
	} else {
		for (const answer of r.answers) {
			if (!answer || typeof answer !== "object") {
				errors.push({
					field: "answers",
					message: "All answers must be objects",
				});
				break;
			}
			const a = answer as Record<string, unknown>;
			if (typeof a.question_id !== "string" || a.question_id.trim() === "") {
				errors.push({
					field: "answers.question_id",
					message: "Must be a non-empty string",
				});
				break;
			}
			if (typeof a.response_text !== "string") {
				errors.push({
					field: "answers.response_text",
					message: "Must be a string",
				});
				break;
			}
		}
	}

	return errors;
}
