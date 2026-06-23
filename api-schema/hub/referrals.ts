export type AgencyReferralState =
	| "pending"
	| "accepted_applied"
	| "declined"
	| "expired"
	| "not_selected";

export interface ListReferralsReceivedRequest {
	pagination_key?: string;
	limit?: number;
}

export interface ReferralReceived {
	referral_id: string;
	agency_org_domain: string;
	agency_org_name: string;
	consumer_org_domain: string;
	opening_number: number;
	opening_title: string;
	statement_text?: string;
	state: AgencyReferralState;
	created_at: string;
	expires_at: string;
}

export interface ListReferralsReceivedResponse {
	referrals: ReferralReceived[];
	next_pagination_key?: string;
}

export interface DeclineReferralRequest {
	referral_id: string;
}

export interface PendingReferralsCountResponse {
	count: number;
}

export interface ValidationError {
	field: string;
	message: string;
}

export function validateListReferralsReceivedRequest(
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

export function validateDeclineReferralRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;
	if (typeof r.referral_id !== "string" || r.referral_id.trim() === "") {
		errors.push({
			field: "referral_id",
			message: "Must be a non-empty string",
		});
	}
	return errors;
}
