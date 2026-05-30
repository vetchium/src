import type { Handle } from "../hub/hub-users.js";
import type {
	ReferenceQuestion,
	ReferenceNominationState,
} from "../hub/references.js";

export interface RequestReferencesRequest {
	candidacy_id: string;
	max_references: number;
	response_deadline: string;
	questions: ReferenceQuestion[];
}

export interface RequestReferencesResponse {
	request_id: string;
}

export interface RequestIdRequest {
	request_id: string;
}

export interface OrgReferenceNomination {
	nomination_id: string;
	nominee_handle: Handle;
	nominee_display_name: string;
	shared_domain: string;
	overlap_start_year: number;
	overlap_end_year: number;
	state: ReferenceNominationState;
	nominated_at: string;
	submitted_at?: string;
}

export interface ListReferenceNominationsResponse {
	nominations: OrgReferenceNomination[];
}

export interface OrgReferenceResponse {
	nomination_id: string;
	nominee_handle: Handle;
	nominee_display_name: string;
	shared_domain: string;
	overlap_start_year: number;
	overlap_end_year: number;
	answers: Array<{
		question_id: string;
		question_text: string;
		response_text: string;
	}>;
	submitted_at: string;
}

export interface ListReferenceResponsesResponse {
	responses: OrgReferenceResponse[];
	declined_nominations: OrgReferenceNomination[];
}

export interface ValidationError {
	field: string;
	message: string;
}

export function validateRequestReferencesRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.candidacy_id !== "string" || r.candidacy_id.trim() === "") {
		errors.push({
			field: "candidacy_id",
			message: "Must be a non-empty string",
		});
	}

	if (
		typeof r.max_references !== "number" ||
		r.max_references < 1 ||
		r.max_references > 5
	) {
		errors.push({
			field: "max_references",
			message: "Must be between 1 and 5",
		});
	}

	if (
		typeof r.response_deadline !== "string" ||
		r.response_deadline.trim() === ""
	) {
		errors.push({
			field: "response_deadline",
			message: "Must be a non-empty string",
		});
	}

	if (!Array.isArray(r.questions)) {
		errors.push({ field: "questions", message: "Must be an array" });
	} else {
		if (r.questions.length < 1 || r.questions.length > 10) {
			errors.push({
				field: "questions",
				message: "Must have 1-10 items",
			});
		}
		for (let i = 0; i < r.questions.length; i++) {
			const q = r.questions[i];
			if (!q || typeof q !== "object") {
				errors.push({
					field: `questions[${i}]`,
					message: "Must be an object",
				});
				continue;
			}
			const qObj = q as Record<string, unknown>;
			if (
				typeof qObj.text !== "string" ||
				qObj.text.length < 10 ||
				qObj.text.length > 500
			) {
				errors.push({
					field: `questions[${i}].text`,
					message: "Must be between 10 and 500 characters",
				});
			}
			if (typeof qObj.min_chars !== "number" || qObj.min_chars < 0) {
				errors.push({
					field: `questions[${i}].min_chars`,
					message: "Must be a non-negative number",
				});
			}
			if (
				typeof qObj.max_chars !== "number" ||
				qObj.max_chars < 1 ||
				qObj.max_chars > 4000
			) {
				errors.push({
					field: `questions[${i}].max_chars`,
					message: "Must be between 1 and 4000",
				});
			}
		}
	}

	return errors;
}

export function validateRequestIdRequest(req: unknown): ValidationError[] {
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
