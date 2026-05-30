import type { Handle } from "./hub-users.js";

export type ReferralState =
	| "pending"
	| "accepted_applied"
	| "declined"
	| "expired";

export interface NominateColleagueRequest {
	candidate_handle: Handle;
	org_domain: string;
	opening_number: number;
	statement_text: string;
}

export interface NominateColleagueResponse {
	nomination_id: string;
}

export interface ReferralReceived {
	nomination_id: string;
	referrer_handle: Handle;
	referrer_display_name: string;
	org_domain: string;
	org_name: string;
	opening_number: number;
	opening_title: string;
	shared_domain: string;
	overlap_start_year: number;
	overlap_end_year: number;
	statement_text: string;
	state: ReferralState;
	created_at: string;
	expires_at: string;
}

export interface ReferralMade {
	nomination_id: string;
	candidate_handle: Handle;
	candidate_display_name: string;
	org_domain: string;
	opening_number: number;
	opening_title: string;
	state: ReferralState;
	candidate_did_apply: boolean;
	created_at: string;
}

export interface ListReferralsRequest {
	pagination_key?: string;
	limit?: number;
}

export interface ListReferralsReceivedResponse {
	referrals: ReferralReceived[];
	next_pagination_key?: string;
}

export interface ListReferralsMadeResponse {
	referrals: ReferralMade[];
	next_pagination_key?: string;
}

export interface AcceptReferralRequest {
	nomination_id: string;
}

export interface AcceptReferralResponse {
	org_domain: string;
	opening_number: number;
	prefill_statement_for_endorsement: string;
}

export interface DeclineReferralRequest {
	nomination_id: string;
}

export interface ValidationError {
	field: string;
	message: string;
}

export function validateNominateColleagueRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (
		typeof r.candidate_handle !== "string" ||
		r.candidate_handle.trim() === ""
	) {
		errors.push({
			field: "candidate_handle",
			message: "Must be a non-empty string",
		});
	}

	if (typeof r.org_domain !== "string" || r.org_domain.trim() === "") {
		errors.push({ field: "org_domain", message: "Must be a non-empty string" });
	}

	if (typeof r.opening_number !== "number" || r.opening_number < 1) {
		errors.push({
			field: "opening_number",
			message: "Must be a positive number",
		});
	}

	if (typeof r.statement_text !== "string") {
		errors.push({ field: "statement_text", message: "Must be a string" });
	} else if (r.statement_text.length < 100 || r.statement_text.length > 2000) {
		errors.push({
			field: "statement_text",
			message: "Must be between 100 and 2000 characters",
		});
	}

	return errors;
}

export function validateListReferralsRequest(req: unknown): ValidationError[] {
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

export function validateAcceptReferralRequest(req: unknown): ValidationError[] {
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

export function validateDeclineReferralRequest(
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
