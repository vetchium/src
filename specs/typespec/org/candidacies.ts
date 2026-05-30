import type { Handle } from "../hub/hub-users.js";
import type {
	CandidacyState,
	InterviewType,
	InterviewState,
	InterviewRSVP,
	CandidacyComment,
} from "../hub/candidacies.js";

export interface ListCandidaciesRequest {
	filter_opening_id?: string;
	filter_state?: CandidacyState[];
	pagination_key?: string;
	limit?: number;
}

export interface OrgCandidacySummary {
	candidacy_id: string;
	application_id: string;
	opening_id: string;
	candidate_handle: Handle;
	candidate_display_name: string;
	state: CandidacyState;
	scheduled_interview_count: number;
	created_at: string;
	state_changed_at: string;
}

export interface ListCandidaciesResponse {
	candidacies: OrgCandidacySummary[];
	next_pagination_key?: string;
}

export interface CandidacyIdRequest {
	candidacy_id: string;
}

export interface OrgInterviewSummary {
	interview_id: string;
	interview_type: InterviewType;
	starts_at: string;
	ends_at: string;
	state: InterviewState;
	interviewer_count: number;
	candidate_rsvp?: InterviewRSVP;
	feedback_submitted_count: number;
}

export interface OrgOfferView {
	extended_by_org_user_id: string;
	extended_at: string;
	salary_currency?: string;
	salary_amount?: number;
	start_date?: string;
	notes?: string;
	offer_letter_download_url: string;
}

export interface OrgCandidacy {
	candidacy_id: string;
	application_id: string;
	opening_id: string;
	opening_title: string;
	candidate_handle: Handle;
	candidate_display_name: string;
	state: CandidacyState;
	created_at: string;
	state_changed_at: string;
	interviews: OrgInterviewSummary[];
	comments: CandidacyComment[];
	offer?: OrgOfferView;
}

export interface OrgAddCandidacyCommentRequest {
	candidacy_id: string;
	body: string;
}

export function validateListCandidaciesRequest(
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

export function validateCandidacyIdRequest(req: unknown): ValidationError[] {
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

export function validateOrgAddCandidacyCommentRequest(
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

export interface ValidationError {
	field: string;
	message: string;
}
