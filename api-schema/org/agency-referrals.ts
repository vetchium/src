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

// ---- Agency side: clients I have an active staffing subscription with ----

// A consumer org that has an active staffing subscription with the caller's
// agency. Available for client-default configuration even before any opening is
// assigned.
export interface StaffingClient {
	consumer_org_domain: string;
	consumer_org_name: string;
}

export interface ListStaffingClientsResponse {
	clients: StaffingClient[];
}

// ---- Agency side: openings I'm assigned to ----

export interface ListAssignedOpeningsRequest {
	filter_client_domain?: string;
	// "" (all) | "me" | "needs_reassignment" | an agency org_user_id
	filter_assignee?: string;
	pagination_key?: string;
	limit?: number;
}

export interface AssignedOpening {
	opening_id: string;
	consumer_org_domain: string;
	opening_number: number;
	title: string;
	assigned_at: string;
	// The single agency recruiter who owns this opening, or undefined when the
	// opening has no assignee yet.
	assignee?: AgencyRecruiterRef;
	// True when the opening has no assignee, or its assignee is no longer an
	// active agency user — i.e. a lead must (re)assign it.
	needs_reassignment: boolean;
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

// ---- Agency side: single-assignee management + per-client default assignee ----

export interface ListAgencyRecruitersResponse {
	recruiters: AgencyRecruiterRef[];
}

// Reassign an opening's single owner to another active agency user.
export interface ReassignOpeningRequest {
	opening_id: string;
	agency_org_user_id: string;
}

// The single default assignee configured for one client domain.
export interface ClientDefaultAssignee {
	consumer_org_domain: string;
	assignee: AgencyRecruiterRef;
}

export interface ListClientDefaultAssigneesResponse {
	defaults: ClientDefaultAssignee[];
}

export interface SetClientDefaultAssigneeRequest {
	consumer_org_domain: string;
	agency_org_user_id: string;
}

export interface ClearClientDefaultAssigneeRequest {
	consumer_org_domain: string;
}

// Dashboard summary: how many of the agency's openings need (re)assignment.
export interface AgencyReferralSummaryResponse {
	needs_reassignment_count: number;
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

export function validateGetAssignedOpeningRequest(
	req: unknown
): ValidationError[] {
	const r = reqObj(req);
	if (!r) return [{ field: "$root", message: "Request body is required" }];
	return nonEmptyString(r, "opening_id");
}

export function validateReassignOpeningRequest(
	req: unknown
): ValidationError[] {
	const r = reqObj(req);
	if (!r) return [{ field: "$root", message: "Request body is required" }];
	return [
		...nonEmptyString(r, "opening_id"),
		...nonEmptyString(r, "agency_org_user_id"),
	];
}

export function validateSetClientDefaultAssigneeRequest(
	req: unknown
): ValidationError[] {
	const r = reqObj(req);
	if (!r) return [{ field: "$root", message: "Request body is required" }];
	return [
		...nonEmptyString(r, "consumer_org_domain"),
		...nonEmptyString(r, "agency_org_user_id"),
	];
}

export function validateClearClientDefaultAssigneeRequest(
	req: unknown
): ValidationError[] {
	const r = reqObj(req);
	if (!r) return [{ field: "$root", message: "Request body is required" }];
	return nonEmptyString(r, "consumer_org_domain");
}
