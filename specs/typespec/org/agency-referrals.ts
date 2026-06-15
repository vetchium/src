import type { Handle } from "../hub/hub-users.js";

export type ApplicationMode = "open" | "agency_only";

export type AgencyReferralState =
	| "pending"
	| "accepted_applied"
	| "declined"
	| "expired"
	| "not_selected";

// A reference to an agency org-user (recruiter) used in selects + recruiter lists.
export interface AgencyRecruiterRef {
	org_user_id: string;
	name: string;
	email: string;
}

// Per-state referral counts for an opening (workspace summary pills).
export interface ReferralStateCounts {
	pending: number;
	accepted_applied: number;
	declined: number;
	expired: number;
	not_selected: number;
}

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

// Consumer's active staffing-subscription providers, eligible to be assigned as
// recruiting agencies on an opening (used to populate the assign-agency picker).
export interface AssignableAgency {
	agency_org_domain: string;
	agency_org_name: string;
}

export interface ListAssignableAgenciesResponse {
	agencies: AssignableAgency[];
}

// ---- Agency side: openings I'm assigned to ----

export interface ListAssignedOpeningsRequest {
	filter_client_domain?: string;
	// "me" | "unassigned" | an agency org_user_id
	filter_recruiter?: string;
	pagination_key?: string;
	limit?: number;
}

export interface AssignedOpening {
	opening_id: string;
	consumer_org_domain: string;
	opening_number: number;
	title: string;
	assigned_at: string;
	// Effective recruiters: explicit assignees if any, else the client-domain defaults.
	recruiters: AgencyRecruiterRef[];
	// True when `recruiters` is inherited from the client-domain default (no explicit owner).
	recruiters_are_default: boolean;
	referral_counts: ReferralStateCounts;
}

export interface ListAssignedOpeningsResponse {
	openings: AssignedOpening[];
	next_pagination_key?: string;
}

// ---- Agency side: single assigned opening (detail page) ----

export interface GetAssignedOpeningRequest {
	opening_id: string;
}

export interface GetAssignedOpeningResponse {
	opening: AssignedOpening;
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
	filter_opening_id?: string;
	pagination_key?: string;
	limit?: number;
}

export interface AgencyReferral {
	referral_id: string;
	candidate_handle: Handle;
	consumer_org_domain: string;
	opening_id: string;
	opening_number: number;
	opening_title: string;
	statement_text?: string;
	state: AgencyReferralState;
	referred_by_name: string;
	created_at: string;
	expires_at: string;
}

export interface ListAgencyReferralsResponse {
	referrals: AgencyReferral[];
	next_pagination_key?: string;
}

// ---- Agency side: internal recruiter assignment + client defaults ----

export interface AssignOpeningRecruitersRequest {
	opening_id: string;
	consumer_org_domain: string;
	agency_org_user_ids: string[];
}

export interface RemoveOpeningRecruiterRequest {
	opening_id: string;
	agency_org_user_id: string;
}

export interface ListAgencyRecruitersResponse {
	recruiters: AgencyRecruiterRef[];
}

export interface ClientDefaultRecruiter {
	consumer_org_domain: string;
	recruiters: AgencyRecruiterRef[];
}

export interface ListClientDefaultRecruitersResponse {
	defaults: ClientDefaultRecruiter[];
}

export interface SetClientDefaultRecruitersRequest {
	consumer_org_domain: string;
	agency_org_user_ids: string[];
}

export interface RemoveClientDefaultRecruiterRequest {
	consumer_org_domain: string;
	agency_org_user_id: string;
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

function nonEmptyString(
	r: Record<string, unknown>,
	field: string
): ValidationError[] {
	if (typeof r[field] !== "string" || (r[field] as string).trim() === "") {
		return [{ field, message: "Must be a non-empty string" }];
	}
	return [];
}

function validateOrgUserIds(r: Record<string, unknown>): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!Array.isArray(r.agency_org_user_ids)) {
		errors.push({
			field: "agency_org_user_ids",
			message: "Must be an array of org_user_id strings",
		});
		return errors;
	}
	if (r.agency_org_user_ids.length === 0) {
		errors.push({
			field: "agency_org_user_ids",
			message: "At least one recruiter is required",
		});
	}
	for (const id of r.agency_org_user_ids) {
		if (typeof id !== "string" || id.trim() === "") {
			errors.push({
				field: "agency_org_user_ids",
				message: "Each id must be a non-empty string",
			});
			break;
		}
	}
	return errors;
}

export function validateGetAssignedOpeningRequest(
	req: unknown
): ValidationError[] {
	const r = reqObj(req);
	if (!r) return [{ field: "$root", message: "Request body is required" }];
	return nonEmptyString(r, "opening_id");
}

export function validateAssignOpeningRecruitersRequest(
	req: unknown
): ValidationError[] {
	const r = reqObj(req);
	if (!r) return [{ field: "$root", message: "Request body is required" }];
	return [
		...nonEmptyString(r, "opening_id"),
		...nonEmptyString(r, "consumer_org_domain"),
		...validateOrgUserIds(r),
	];
}

export function validateRemoveOpeningRecruiterRequest(
	req: unknown
): ValidationError[] {
	const r = reqObj(req);
	if (!r) return [{ field: "$root", message: "Request body is required" }];
	return [
		...nonEmptyString(r, "opening_id"),
		...nonEmptyString(r, "agency_org_user_id"),
	];
}

export function validateSetClientDefaultRecruitersRequest(
	req: unknown
): ValidationError[] {
	const r = reqObj(req);
	if (!r) return [{ field: "$root", message: "Request body is required" }];
	return [
		...nonEmptyString(r, "consumer_org_domain"),
		...validateOrgUserIds(r),
	];
}

export function validateRemoveClientDefaultRecruiterRequest(
	req: unknown
): ValidationError[] {
	const r = reqObj(req);
	if (!r) return [{ field: "$root", message: "Request body is required" }];
	return [
		...nonEmptyString(r, "consumer_org_domain"),
		...nonEmptyString(r, "agency_org_user_id"),
	];
}
