import type { Handle } from "./hub-users.js";

export type ApplicationState =
	| "applied"
	| "shortlisted"
	| "rejected"
	| "withdrawn"
	| "expired";
export type ApplicationColorLabel = "green" | "yellow" | "red";

export interface ApplyForOpeningRequest {
	org_domain: string;
	opening_number: number;
	cover_letter: string;
	resume_upload_id: string;
	endorser_handles?: Handle[];
	endorsement_request_note?: string;
}

export interface ApplyForOpeningResponse {
	application_id: string;
}

export interface WithdrawApplicationRequest {
	application_id: string;
}

export interface HubApplicationSummary {
	application_id: string;
	org_domain: string;
	org_name: string;
	opening_number: number;
	opening_title: string;
	state: ApplicationState;
	label?: ApplicationColorLabel;
	endorsement_count: number;
	applied_at: string;
	state_changed_at: string;
}

export interface HubApplication {
	application_id: string;
	org_domain: string;
	org_name: string;
	opening_number: number;
	opening_title: string;
	state: ApplicationState;
	label?: ApplicationColorLabel;
	ai_score?: number;
	applied_at: string;
	state_changed_at: string;
	cover_letter: string;
	resume_download_url: string;
	endorsements: MyEndorsementOnApplication[];
	endorsement_requests: MyEndorsementRequestSent[];
	candidacy_id?: string;
}

export interface MyEndorsementOnApplication {
	endorsement_id: string;
	endorser_handle: Handle;
	endorser_display_name: string;
	shared_domain: string;
	overlap_start_year: number;
	overlap_end_year: number;
	is_referral: boolean;
	is_unsolicited: boolean;
	text: string;
	hidden_by_candidate: boolean;
	written_at: string;
	edited_at?: string;
}

export interface MyEndorsementRequestSent {
	request_id: string;
	endorser_handle: Handle;
	endorser_display_name: string;
	shared_domain: string;
	overlap_start_year: number;
	overlap_end_year: number;
	state: "pending" | "written" | "declined" | "expired";
	requested_at: string;
}

export interface ListMyApplicationsRequest {
	filter_state?: ApplicationState[];
	pagination_key?: string;
	limit?: number;
}

export interface ListMyApplicationsResponse {
	applications: HubApplicationSummary[];
	next_pagination_key?: string;
}

export interface GetMyApplicationRequest {
	application_id: string;
}

export function validateWithdrawApplicationRequest(
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

	return errors;
}

export function validateListMyApplicationsRequest(
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

export function validateGetMyApplicationRequest(
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

	return errors;
}

export interface ValidationError {
	field: string;
	message: string;
}
