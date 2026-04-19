import { newValidationError, type ValidationError } from "../common/common";

export interface OrgTier {
	tier_id: string;
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

export interface OrgTierUsage {
	org_users: number;
	domains_verified: number;
	suborgs: number;
	marketplace_listings: number;
}

export interface OrgSubscription {
	org_id: string;
	org_domain: string;
	current_tier: OrgTier;
	usage: OrgTierUsage;
	updated_at: string;
	note: string;
}

export interface ListOrgTiersRequest {}

export interface ListOrgTiersResponse {
	tiers: OrgTier[];
}

export interface GetMyOrgSubscriptionRequest {}

export interface SelfUpgradeOrgSubscriptionRequest {
	tier_id: string;
}

export interface AdminListOrgSubscriptionsRequest {
	filter_tier_id?: string;
	pagination_key?: string;
	limit?: number;
}

export interface AdminListOrgSubscriptionsResponse {
	items: OrgSubscription[];
	next_pagination_key?: string;
}

export interface AdminSetOrgTierRequest {
	org_id: string;
	tier_id: string;
	reason: string;
}

const VALID_TIER_IDS = ["free", "silver", "gold", "enterprise"] as const;
type TierId = (typeof VALID_TIER_IDS)[number];

export function validateSelfUpgradeOrgSubscriptionRequest(
	req: SelfUpgradeOrgSubscriptionRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.tier_id || !VALID_TIER_IDS.includes(req.tier_id as TierId)) {
		errs.push(newValidationError("tier_id", "must be a valid tier id"));
	}
	return errs;
}

export function validateAdminListOrgSubscriptionsRequest(
	req: AdminListOrgSubscriptionsRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (
		req.filter_tier_id !== undefined &&
		req.filter_tier_id !== "" &&
		!VALID_TIER_IDS.includes(req.filter_tier_id as TierId)
	) {
		errs.push(newValidationError("filter_tier_id", "must be a valid tier id"));
	}
	if (req.limit !== undefined && (req.limit < 1 || req.limit > 100)) {
		errs.push(newValidationError("limit", "must be between 1 and 100"));
	}
	return errs;
}

export function validateAdminSetOrgTierRequest(
	req: AdminSetOrgTierRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.org_id) {
		errs.push(newValidationError("org_id", "org_id is required"));
	}
	if (!req.tier_id || !VALID_TIER_IDS.includes(req.tier_id as TierId)) {
		errs.push(newValidationError("tier_id", "must be a valid tier id"));
	}
	if (req.reason === undefined || req.reason === null) {
		errs.push(newValidationError("reason", "reason is required"));
	} else if (req.reason.length > 2000) {
		errs.push(newValidationError("reason", "must be at most 2000 characters"));
	}
	return errs;
}
