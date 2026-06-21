import { newValidationError, type ValidationError } from "../common/common";

export interface Plan {
	plan_id: string;
	display_name: string;
	description: string;
	display_order: number;
	org_users_cap?: number;
	domains_verified_cap?: number;
	suborgs_cap?: number;
	marketplace_listings_cap?: number;
	audit_retention_days?: number;
	self_upgradeable: boolean;
}

export interface PlanUsage {
	org_users: number;
	domains_verified: number;
	suborgs: number;
	marketplace_listings: number;
}

export interface OrgPlan {
	org_id: string;
	org_domain: string;
	current_plan: Plan;
	usage: PlanUsage;
	updated_at: string;
	note: string;
}

export interface ListPlansRequest {}

export interface ListPlansResponse {
	plans: Plan[];
}

export interface GetMyOrgPlanRequest {}

export interface UpgradeOrgPlanRequest {
	plan_id: string;
}

export interface AdminListOrgPlansRequest {
	filter_plan_id?: string;
	filter_domain?: string;
	pagination_key?: string;
	limit?: number;
}

export interface AdminListOrgPlansResponse {
	org_plans: OrgPlan[];
	next_pagination_key?: string;
}

export interface AdminSetOrgPlanRequest {
	org_id: string;
	plan_id: string;
	reason: string;
}

const VALID_PLAN_IDS = ["free", "silver", "gold", "enterprise"] as const;
type PlanId = (typeof VALID_PLAN_IDS)[number];

export function validateUpgradeOrgPlanRequest(
	req: UpgradeOrgPlanRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.plan_id || !VALID_PLAN_IDS.includes(req.plan_id as PlanId)) {
		errs.push(newValidationError("plan_id", "must be a valid plan id"));
	}
	return errs;
}

export function validateAdminListOrgPlansRequest(
	req: AdminListOrgPlansRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (
		req.filter_plan_id !== undefined &&
		req.filter_plan_id !== "" &&
		!VALID_PLAN_IDS.includes(req.filter_plan_id as PlanId)
	) {
		errs.push(newValidationError("filter_plan_id", "must be a valid plan id"));
	}
	if (req.limit !== undefined && (req.limit < 1 || req.limit > 100)) {
		errs.push(newValidationError("limit", "must be between 1 and 100"));
	}
	return errs;
}

export function validateAdminSetOrgPlanRequest(
	req: AdminSetOrgPlanRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.org_id) {
		errs.push(newValidationError("org_id", "org_id is required"));
	}
	if (!req.plan_id || !VALID_PLAN_IDS.includes(req.plan_id as PlanId)) {
		errs.push(newValidationError("plan_id", "must be a valid plan id"));
	}
	if (req.reason === undefined || req.reason === null || req.reason === "") {
		errs.push(newValidationError("reason", "reason is required"));
	} else if (req.reason.length > 2000) {
		errs.push(newValidationError("reason", "must be at most 2000 characters"));
	}
	return errs;
}
