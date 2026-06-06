import type {
	InterviewType,
	InterviewState,
	InterviewRSVP,
} from "../hub/candidacies.js";
import type { OrgInterviewSummary } from "./candidacies.js";

export type FeedbackDecision =
	| "strong_yes"
	| "yes"
	| "neutral"
	| "no"
	| "strong_no";

export interface ScheduleInterviewRequest {
	candidacy_id: string;
	interview_type: InterviewType;
	starts_at: string;
	ends_at: string;
	description?: string;
	/** Free-text physical address or video-meeting link (0..2000). */
	interview_location?: string;
	interviewer_email_addresses: string[];
}

export interface ScheduleInterviewResponse {
	interview_id: string;
}

export interface UpdateInterviewRequest {
	interview_id: string;
	starts_at?: string;
	ends_at?: string;
	description?: string;
	interview_location?: string;
}

export interface InterviewIdRequest {
	interview_id: string;
}

export interface AddInterviewerRequest {
	interview_id: string;
	org_user_email_address: string;
}

export interface RemoveInterviewerRequest {
	interview_id: string;
	org_user_id: string;
}

export interface SetInterviewerRSVPRequest {
	interview_id: string;
	rsvp: InterviewRSVP;
}

export interface SubmitInterviewFeedbackRequest {
	interview_id: string;
	decision: FeedbackDecision;
	positives: string;
	negatives: string;
	overall_assessment: string;
	candidate_feedback?: string;
}

export interface InterviewerEntry {
	org_user_id: string;
	org_user_email_address: string;
	display_name: string;
	rsvp?: InterviewRSVP;
	feedback_submitted: boolean;
}

export interface InterviewFeedback {
	org_user_id: string;
	decision: FeedbackDecision;
	positives: string;
	negatives: string;
	overall_assessment: string;
	candidate_feedback?: string;
	submitted_at: string;
	updated_at: string;
}

export type FeedbackState = "draft" | "submitted";

/** The calling interviewer's own feedback (draft or submitted) for an interview. */
export interface MyInterviewFeedback {
	interview_id: string;
	state: FeedbackState;
	decision: FeedbackDecision;
	positives: string;
	negatives: string;
	overall_assessment: string;
	candidate_feedback?: string;
	submitted_at?: string;
	updated_at: string;
}

export interface OrgInterview {
	interview_id: string;
	candidacy_id: string;
	interview_type: InterviewType;
	starts_at: string;
	ends_at: string;
	description?: string;
	interview_location?: string;
	state: InterviewState;
	candidate_rsvp?: InterviewRSVP;
	interviewers: InterviewerEntry[];
	feedback: InterviewFeedback[];
}

export interface ListInterviewsRequest {
	filter_candidacy_id?: string;
	filter_state?: InterviewState[];
	filter_starts_at_from?: string;
	filter_starts_at_to?: string;
	pagination_key?: string;
	limit?: number;
}

export interface ListInterviewsResponse {
	interviews: OrgInterviewSummary[];
	next_pagination_key?: string;
}

export interface OrgMyInterview {
	interview_id: string;
	candidacy_id: string;
	opening_title: string;
	candidate_name: string;
	interview_type: InterviewType;
	starts_at: string;
	ends_at: string;
	state: InterviewState;
	my_rsvp?: InterviewRSVP;
	feedback_submitted: boolean;
}

export interface ListMyInterviewsRequest {
	filter_state?: InterviewState[];
	pagination_key?: string;
	limit?: number;
}

export interface ListMyInterviewsResponse {
	interviews: OrgMyInterview[];
	next_pagination_key?: string;
}

export interface ValidationError {
	field: string;
	message: string;
}

export function validateScheduleInterviewRequest(
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

	if (!isValidInterviewType(r.interview_type)) {
		errors.push({
			field: "interview_type",
			message: "Must be one of: in_person, video, take_home, other",
		});
	}

	if (typeof r.starts_at !== "string") {
		errors.push({ field: "starts_at", message: "Must be a valid datetime" });
	}

	if (typeof r.ends_at !== "string") {
		errors.push({ field: "ends_at", message: "Must be a valid datetime" });
	}

	if (r.description !== undefined) {
		if (typeof r.description !== "string") {
			errors.push({ field: "description", message: "Must be a string" });
		} else if (r.description.length > 2000) {
			errors.push({
				field: "description",
				message: "Must be at most 2000 characters",
			});
		}
	}

	if (r.interview_location !== undefined) {
		if (typeof r.interview_location !== "string") {
			errors.push({ field: "interview_location", message: "Must be a string" });
		} else if (r.interview_location.length > 2000) {
			errors.push({
				field: "interview_location",
				message: "Must be at most 2000 characters",
			});
		}
	}

	if (!Array.isArray(r.interviewer_email_addresses)) {
		errors.push({
			field: "interviewer_email_addresses",
			message: "Must be an array",
		});
	} else {
		if (
			r.interviewer_email_addresses.length < 1 ||
			r.interviewer_email_addresses.length > 5
		) {
			errors.push({
				field: "interviewer_email_addresses",
				message: "Must have 1-5 items",
			});
		}
		for (const email of r.interviewer_email_addresses) {
			if (typeof email !== "string" || email.trim() === "") {
				errors.push({
					field: "interviewer_email_addresses",
					message: "All items must be non-empty strings",
				});
				break;
			}
		}
	}

	return errors;
}

export function validateUpdateInterviewRequest(
	req: unknown
): ValidationError[] {
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

	if (r.starts_at !== undefined && typeof r.starts_at !== "string") {
		errors.push({ field: "starts_at", message: "Must be a valid datetime" });
	}

	if (r.ends_at !== undefined && typeof r.ends_at !== "string") {
		errors.push({ field: "ends_at", message: "Must be a valid datetime" });
	}

	if (r.description !== undefined) {
		if (typeof r.description !== "string") {
			errors.push({ field: "description", message: "Must be a string" });
		} else if (r.description.length > 2000) {
			errors.push({
				field: "description",
				message: "Must be at most 2000 characters",
			});
		}
	}

	if (r.interview_location !== undefined) {
		if (typeof r.interview_location !== "string") {
			errors.push({ field: "interview_location", message: "Must be a string" });
		} else if (r.interview_location.length > 2000) {
			errors.push({
				field: "interview_location",
				message: "Must be at most 2000 characters",
			});
		}
	}

	return errors;
}

export function validateInterviewIdRequest(req: unknown): ValidationError[] {
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

	return errors;
}

export function validateAddInterviewerRequest(req: unknown): ValidationError[] {
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

	if (
		typeof r.org_user_email_address !== "string" ||
		r.org_user_email_address.trim() === ""
	) {
		errors.push({
			field: "org_user_email_address",
			message: "Must be a non-empty string",
		});
	}

	return errors;
}

export function validateRemoveInterviewerRequest(
	req: unknown
): ValidationError[] {
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

	if (typeof r.org_user_id !== "string" || r.org_user_id.trim() === "") {
		errors.push({
			field: "org_user_id",
			message: "Must be a non-empty string",
		});
	}

	return errors;
}

export function validateSetInterviewerRSVPRequest(
	req: unknown
): ValidationError[] {
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

	if (!isValidInterviewRSVP(r.rsvp)) {
		errors.push({ field: "rsvp", message: "Must be one of: yes, no" });
	}

	return errors;
}

export function validateSubmitInterviewFeedbackRequest(
	req: unknown
): ValidationError[] {
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

	if (!isValidFeedbackDecision(r.decision)) {
		errors.push({
			field: "decision",
			message: "Must be one of: strong_yes, yes, neutral, no, strong_no",
		});
	}

	if (typeof r.positives !== "string") {
		errors.push({ field: "positives", message: "Must be a string" });
	} else if (r.positives.length < 1 || r.positives.length > 4000) {
		errors.push({
			field: "positives",
			message: "Must be between 1 and 4000 characters",
		});
	}

	if (typeof r.negatives !== "string") {
		errors.push({ field: "negatives", message: "Must be a string" });
	} else if (r.negatives.length < 1 || r.negatives.length > 4000) {
		errors.push({
			field: "negatives",
			message: "Must be between 1 and 4000 characters",
		});
	}

	if (typeof r.overall_assessment !== "string") {
		errors.push({ field: "overall_assessment", message: "Must be a string" });
	} else if (
		r.overall_assessment.length < 1 ||
		r.overall_assessment.length > 4000
	) {
		errors.push({
			field: "overall_assessment",
			message: "Must be between 1 and 4000 characters",
		});
	}

	if (r.candidate_feedback !== undefined) {
		if (typeof r.candidate_feedback !== "string") {
			errors.push({ field: "candidate_feedback", message: "Must be a string" });
		} else if (r.candidate_feedback.length > 2000) {
			errors.push({
				field: "candidate_feedback",
				message: "Must be at most 2000 characters",
			});
		}
	}

	return errors;
}

export function validateListInterviewsRequest(req: unknown): ValidationError[] {
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

function isValidInterviewType(value: unknown): value is InterviewType {
	return (
		value === "in_person" ||
		value === "video" ||
		value === "take_home" ||
		value === "other"
	);
}

function isValidInterviewRSVP(value: unknown): value is InterviewRSVP {
	return value === "yes" || value === "no";
}

function isValidFeedbackDecision(value: unknown): value is FeedbackDecision {
	return (
		value === "strong_yes" ||
		value === "yes" ||
		value === "neutral" ||
		value === "no" ||
		value === "strong_no"
	);
}
