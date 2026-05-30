import type { Handle } from "../hub/hub-users.js";
import type { PublicEmployerStint } from "../hub/work-emails.js";
import type { ConnectionState } from "../hub/connections.js";
import type {
	ApplicationState,
	ApplicationColorLabel,
} from "../hub/applications.js";

export interface ListApplicationsRequest {
	opening_id: string;
	filter_state?: ApplicationState[];
	filter_label?: ApplicationColorLabel[];
	filter_has_endorsements?: boolean;
	filter_has_referral?: boolean;
	pagination_key?: string;
	limit?: number;
}

export interface OrgApplicationSummary {
	application_id: string;
	candidate_handle: Handle;
	candidate_display_name: string;
	yoe_total: number;
	endorsement_count: number;
	has_referral: boolean;
	ai_score?: number;
	state: ApplicationState;
	label?: ApplicationColorLabel;
	applied_at: string;
}

export interface ListApplicationsResponse {
	applications: OrgApplicationSummary[];
	next_pagination_key?: string;
}

export interface ApplicationIdRequest {
	application_id: string;
}

export interface OrgVisibleEndorsement {
	endorsement_id: string;
	endorser_handle: Handle;
	endorser_display_name: string;
	shared_domain: string;
	overlap_start_year: number;
	overlap_end_year: number;
	current_connection_state: ConnectionState;
	is_referral: boolean;
	is_unsolicited: boolean;
	endorser_is_current_employee: boolean;
	text: string;
	written_at: string;
	edited_at?: string;
}

export interface OrgApplication {
	application_id: string;
	opening_id: string;
	candidate_handle: Handle;
	candidate_display_name: string;
	candidate_short_bio?: string;
	candidate_employer_stints: PublicEmployerStint[];
	cover_letter: string;
	resume_download_url: string;
	ai_score?: number;
	state: ApplicationState;
	label?: ApplicationColorLabel;
	applied_at: string;
	state_changed_at: string;
	endorsements: OrgVisibleEndorsement[];
	notify_colleagues_used: boolean;
}

export interface ShortlistApplicationRequest {
	application_id: string;
}

export interface RejectApplicationRequest {
	application_id: string;
	rejection_reason?: string;
}

export interface LabelApplicationRequest {
	application_id: string;
	label?: ApplicationColorLabel;
}

export function validateListApplicationsRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.opening_id !== "string" || r.opening_id.trim() === "") {
		errors.push({ field: "opening_id", message: "Must be a non-empty string" });
	}

	if (r.limit !== undefined) {
		if (typeof r.limit !== "number" || r.limit < 1 || r.limit > 100) {
			errors.push({ field: "limit", message: "Must be between 1 and 100" });
		}
	}

	return errors;
}

export function validateApplicationIdRequest(req: unknown): ValidationError[] {
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

export function validateShortlistApplicationRequest(
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

export function validateRejectApplicationRequest(
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

	if (r.rejection_reason !== undefined) {
		if (typeof r.rejection_reason !== "string") {
			errors.push({ field: "rejection_reason", message: "Must be a string" });
		} else if (r.rejection_reason.length > 2000) {
			errors.push({
				field: "rejection_reason",
				message: "Must be at most 2000 characters",
			});
		}
	}

	return errors;
}

export function validateLabelApplicationRequest(
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

	if (r.label !== undefined && r.label !== null) {
		if (r.label !== "green" && r.label !== "yellow" && r.label !== "red") {
			errors.push({
				field: "label",
				message: 'Must be "green", "yellow", "red", or null',
			});
		}
	}

	return errors;
}

export interface ValidationError {
	field: string;
	message: string;
}
