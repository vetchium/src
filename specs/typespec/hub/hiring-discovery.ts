import type { Handle } from "./hub-users.js";
import type {
	Opening,
	EmploymentType,
	WorkLocationType,
} from "../org/openings.js";

export interface HubOpeningCard {
	org_domain: string;
	org_name: string;
	opening_number: number;
	title: string;
	primary_city?: string;
	employment_type: EmploymentType;
	work_location_type: WorkLocationType;
	first_published_at: string;
	colleague_count_here: number;
}

export interface HubListOpeningsRequest {
	filter_query?: string;
	filter_employment_type?: EmploymentType[];
	filter_work_location_type?: WorkLocationType[];
	filter_country?: string;
	filter_min_yoe?: number;
	filter_tag_ids?: string[];
	filter_only_with_colleagues?: boolean;
	pagination_key?: string;
	limit?: number;
}

export interface HubListOpeningsResponse {
	openings: HubOpeningCard[];
	next_pagination_key?: string;
}

export interface HubGetOpeningRequest {
	org_domain: string;
	opening_number: number;
}

export interface HubOpeningDetail extends Opening {
	colleague_count_here: number;
	viewer_can_refer: boolean;
	viewer_has_applied: boolean;
}

export interface ListColleaguesAtEmployerRequest {
	org_domain: string;
	pagination_key?: string;
	limit?: number;
}

export interface ColleagueAtEmployer {
	handle: Handle;
	display_name: string;
	shared_domain: string;
	overlap_start_year: number;
	overlap_end_year: number;
	current_employer_domain: string;
	current_stint_started_at: string;
}

export interface ListColleaguesAtEmployerResponse {
	colleagues: ColleagueAtEmployer[];
	next_pagination_key?: string;
}

export interface NetworkOpportunity {
	org_domain: string;
	org_name: string;
	colleague_count: number;
	most_recent_colleague_started_at: string;
	openings: HubOpeningCard[];
}

export interface ListNetworkOpportunitiesResponse {
	opportunities: NetworkOpportunity[];
}

export function validateHubListOpeningsRequest(
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

	if (r.filter_min_yoe !== undefined) {
		if (typeof r.filter_min_yoe !== "number" || r.filter_min_yoe < 0) {
			errors.push({
				field: "filter_min_yoe",
				message: "Must be a non-negative number",
			});
		}
	}

	return errors;
}

export function validateHubGetOpeningRequest(req: unknown): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.org_domain !== "string" || r.org_domain.trim() === "") {
		errors.push({ field: "org_domain", message: "Must be a non-empty string" });
	}

	if (typeof r.opening_number !== "number" || r.opening_number < 1) {
		errors.push({
			field: "opening_number",
			message: "Must be a positive number",
		});
	}

	return errors;
}

export function validateListColleaguesAtEmployerRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.org_domain !== "string" || r.org_domain.trim() === "") {
		errors.push({ field: "org_domain", message: "Must be a non-empty string" });
	}

	if (r.limit !== undefined) {
		if (typeof r.limit !== "number" || r.limit < 1 || r.limit > 100) {
			errors.push({ field: "limit", message: "Must be between 1 and 100" });
		}
	}

	return errors;
}

export interface ValidationError {
	field: string;
	message: string;
}
