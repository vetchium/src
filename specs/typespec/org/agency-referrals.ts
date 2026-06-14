import type { Handle } from "../hub/hub-users.js";

export type ApplicationMode = "open" | "agency_only";

export type AgencyReferralState =
	| "pending"
	| "accepted_applied"
	| "declined"
	| "expired"
	| "not_selected";

// ---- Consumer side: assign / list / remove agencies on an opening ----

export interface AssignOpeningAgencyRequest {
	opening_id: string;
	agency_org_domain: string;
}

export interface RemoveOpeningAgencyRequest {
	opening_id: string;
	agency_org_domain: string;
}

export interface ListOpeningAgenciesRequest {
	opening_id: string;
}

export interface OpeningAgency {
	agency_org_domain: string;
	agency_org_name: string;
	assigned_at: string;
	referrals_made: number;
}

export interface ListOpeningAgenciesResponse {
	agencies: OpeningAgency[];
}

// ---- Agency side: openings I'm assigned to ----

export interface ListAssignedOpeningsRequest {
	pagination_key?: string;
	limit?: number;
}

export interface AssignedOpening {
	opening_id: string;
	consumer_org_domain: string;
	opening_number: number;
	title: string;
	assigned_at: string;
}

export interface ListAssignedOpeningsResponse {
	openings: AssignedOpening[];
	next_pagination_key?: string;
}

// ---- Agency side: refer a candidate ----

export interface ReferCandidateRequest {
	opening_id: string;
	candidate_handle: Handle;
	statement_text?: string;
}

export interface ReferCandidateResponse {
	referral_id: string;
}

// ---- Agency side: referrals my agency has made ----

export interface ListAgencyReferralsRequest {
	pagination_key?: string;
	limit?: number;
}

export interface AgencyReferral {
	referral_id: string;
	candidate_handle: Handle;
	consumer_org_domain: string;
	opening_number: number;
	opening_title: string;
	state: AgencyReferralState;
	created_at: string;
}

export interface ListAgencyReferralsResponse {
	referrals: AgencyReferral[];
	next_pagination_key?: string;
}

export interface ValidationError {
	field: string;
	message: string;
}

function reqObj(req: unknown): Record<string, unknown> | null {
	if (!req || typeof req !== "object") return null;
	return req as Record<string, unknown>;
}

export function validateAssignOpeningAgencyRequest(
	req: unknown
): ValidationError[] {
	const r = reqObj(req);
	if (!r) return [{ field: "$root", message: "Request body is required" }];
	const errors: ValidationError[] = [];
	if (typeof r.opening_id !== "string" || r.opening_id.trim() === "") {
		errors.push({ field: "opening_id", message: "Must be a non-empty string" });
	}
	if (
		typeof r.agency_org_domain !== "string" ||
		r.agency_org_domain.trim() === ""
	) {
		errors.push({
			field: "agency_org_domain",
			message: "Must be a non-empty string",
		});
	}
	return errors;
}

export function validateRemoveOpeningAgencyRequest(
	req: unknown
): ValidationError[] {
	return validateAssignOpeningAgencyRequest(req);
}

export function validateListOpeningAgenciesRequest(
	req: unknown
): ValidationError[] {
	const r = reqObj(req);
	if (!r) return [{ field: "$root", message: "Request body is required" }];
	const errors: ValidationError[] = [];
	if (typeof r.opening_id !== "string" || r.opening_id.trim() === "") {
		errors.push({ field: "opening_id", message: "Must be a non-empty string" });
	}
	return errors;
}

function validateOptionalPagination(
	r: Record<string, unknown>
): ValidationError[] {
	const errors: ValidationError[] = [];
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

export function validateListAssignedOpeningsRequest(
	req: unknown
): ValidationError[] {
	const r = reqObj(req);
	if (!r) return [{ field: "$root", message: "Request body is required" }];
	return validateOptionalPagination(r);
}

export function validateListAgencyReferralsRequest(
	req: unknown
): ValidationError[] {
	const r = reqObj(req);
	if (!r) return [{ field: "$root", message: "Request body is required" }];
	return validateOptionalPagination(r);
}

export function validateReferCandidateRequest(req: unknown): ValidationError[] {
	const r = reqObj(req);
	if (!r) return [{ field: "$root", message: "Request body is required" }];
	const errors: ValidationError[] = [];
	if (typeof r.opening_id !== "string" || r.opening_id.trim() === "") {
		errors.push({ field: "opening_id", message: "Must be a non-empty string" });
	}
	if (
		typeof r.candidate_handle !== "string" ||
		r.candidate_handle.trim() === ""
	) {
		errors.push({
			field: "candidate_handle",
			message: "Must be a non-empty string",
		});
	}
	if (r.statement_text !== undefined) {
		if (typeof r.statement_text !== "string") {
			errors.push({ field: "statement_text", message: "Must be a string" });
		} else if (r.statement_text.length > 2000) {
			errors.push({
				field: "statement_text",
				message: "Must be at most 2000 characters",
			});
		}
	}
	return errors;
}
