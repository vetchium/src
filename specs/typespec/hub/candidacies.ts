import type { Handle } from "./hub-users.js";

export type CandidacyState =
	| "interviewing"
	| "offered"
	| "offer_accepted"
	| "offer_declined"
	| "candidate_unsuitable"
	| "candidate_not_responding"
	| "employer_defunct";

export type InterviewType = "in_person" | "video" | "take_home" | "other";
export type InterviewState = "scheduled" | "completed" | "cancelled";
export type InterviewRSVP = "yes" | "no";

export interface HubCandidacySummary {
	candidacy_id: string;
	application_id: string;
	org_domain: string;
	org_name: string;
	opening_title: string;
	state: CandidacyState;
	created_at: string;
	state_changed_at: string;
	latest_activity_at: string;
}

export interface HubInterview {
	interview_id: string;
	interview_type: InterviewType;
	starts_at: string;
	ends_at: string;
	description?: string;
	state: InterviewState;
	candidate_rsvp?: InterviewRSVP;
	interviewer_rsvp_summary: {
		total: number;
		yes: number;
		no: number;
		pending: number;
	};
}

export interface CandidacyComment {
	comment_id: string;
	author_kind: "org_user" | "hub_user" | "system";
	author_handle?: Handle;
	body: string;
	created_at: string;
}

export interface HubOfferView {
	extended_at: string;
	salary_currency?: string;
	salary_amount?: number;
	start_date?: string;
	notes?: string;
}

export interface HubCandidacy {
	candidacy_id: string;
	application_id: string;
	org_domain: string;
	org_name: string;
	opening_number: number;
	opening_title: string;
	state: CandidacyState;
	created_at: string;
	state_changed_at: string;
	interviews: HubInterview[];
	comments: CandidacyComment[];
	offer?: HubOfferView;
}

export interface ListMyCandidaciesRequest {
	filter_state?: CandidacyState[];
	pagination_key?: string;
	limit?: number;
}

export interface ListMyCandidaciesResponse {
	candidacies: HubCandidacySummary[];
	next_pagination_key?: string;
}

export interface GetMyCandidacyRequest {
	candidacy_id: string;
}

export interface AddCandidacyCommentRequest {
	candidacy_id: string;
	body: string;
}

export interface RSVPInterviewRequest {
	interview_id: string;
	rsvp: InterviewRSVP;
}

export interface HubMyInterview {
	interview_id: string;
	candidacy_id: string;
	opening_title: string;
	interview_type: InterviewType;
	starts_at: string;
	ends_at: string;
	state: InterviewState;
	candidate_rsvp?: InterviewRSVP;
}

export interface ListMyInterviewsRequest {
	filter_state?: InterviewState[];
	pagination_key?: string;
	limit?: number;
}

export interface ListMyInterviewsResponse {
	interviews: HubMyInterview[];
	next_pagination_key?: string;
}

export function validateListMyCandidaciesRequest(
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

export function validateGetMyCandidacyRequest(req: unknown): ValidationError[] {
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

	return errors;
}

export function validateAddCandidacyCommentRequest(
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

	if (typeof r.body !== "string") {
		errors.push({ field: "body", message: "Must be a string" });
	} else if (r.body.length < 1 || r.body.length > 4000) {
		errors.push({
			field: "body",
			message: "Must be between 1 and 4000 characters",
		});
	}

	return errors;
}

export function validateRSVPInterviewRequest(req: unknown): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.interview_id !== "string" || r.interview_id.trim() === "") {
		errors.push({
			field: "interview_id",
			message: "Must be a non-empty string",
		});
	}

	if (r.rsvp !== "yes" && r.rsvp !== "no") {
		errors.push({ field: "rsvp", message: 'Must be "yes" or "no"' });
	}

	return errors;
}

export function validateListMyInterviewsRequest(
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

export interface ValidationError {
	field: string;
	message: string;
}
