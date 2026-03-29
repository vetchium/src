import { type ValidationError, newValidationError } from "../common/common";
import type {
	OrgCapabilityStatus,
	ServiceListingState,
	OrgCapability,
	ServiceListing,
} from "../org/marketplace";

export type {
	OrgCapabilityStatus,
	ServiceListingState,
	OrgCapability,
	ServiceListing,
};

// ---- Capability admin requests ----

export interface ListMarketplaceProviderCapabilitiesRequest {
	filter_status?: OrgCapabilityStatus;
	filter_org_domain?: string;
	cursor?: string;
	limit?: number;
}

export interface ListMarketplaceProviderCapabilitiesResponse {
	capabilities: OrgCapability[];
	next_cursor?: string;
}

export interface ApproveMarketplaceProviderCapabilityRequest {
	org_domain: string;
	subscription_price: number;
	currency: string;
	subscription_period_days: number;
}

export function validateApproveMarketplaceProviderCapabilityRequest(
	req: ApproveMarketplaceProviderCapabilityRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.org_domain) {
		errs.push(newValidationError("org_domain", "org_domain is required"));
	}
	if (req.subscription_price < 0) {
		errs.push(
			newValidationError(
				"subscription_price",
				"subscription_price must be non-negative"
			)
		);
	}
	if (!req.currency || req.currency.length !== 3) {
		errs.push(
			newValidationError(
				"currency",
				"currency must be a 3-letter ISO 4217 code"
			)
		);
	}
	if (!req.subscription_period_days || req.subscription_period_days <= 0) {
		errs.push(
			newValidationError(
				"subscription_period_days",
				"subscription_period_days must be positive"
			)
		);
	}
	return errs;
}

export interface RejectMarketplaceProviderCapabilityRequest {
	org_domain: string;
	admin_note: string;
}

export function validateRejectMarketplaceProviderCapabilityRequest(
	req: RejectMarketplaceProviderCapabilityRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.org_domain) {
		errs.push(newValidationError("org_domain", "org_domain is required"));
	}
	if (!req.admin_note) {
		errs.push(newValidationError("admin_note", "admin_note is required"));
	}
	return errs;
}

export interface RenewMarketplaceProviderCapabilityRequest {
	org_domain: string;
	subscription_price: number;
	currency: string;
	subscription_period_days: number;
}

export interface RevokeMarketplaceProviderCapabilityRequest {
	org_domain: string;
	admin_note: string;
}

export interface ReinstateMarketplaceProviderCapabilityRequest {
	org_domain: string;
	subscription_price: number;
	currency: string;
	subscription_period_days: number;
}

// ---- ServiceListing admin requests ----

export interface AdminListMarketplaceServiceListingsRequest {
	filter_state?: ServiceListingState;
	filter_org_domain?: string;
	has_reports?: boolean;
	cursor?: string;
	limit?: number;
}

export interface AdminListMarketplaceServiceListingsResponse {
	service_listings: ServiceListing[];
	next_cursor?: string;
}

export interface AdminGetMarketplaceServiceListingRequest {
	org_domain: string;
	name: string;
}

export interface AdminApproveMarketplaceServiceListingRequest {
	org_domain: string;
	name: string;
	admin_verification_note: string;
	verification_id: string;
}

export function validateAdminApproveMarketplaceServiceListingRequest(
	req: AdminApproveMarketplaceServiceListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.org_domain) {
		errs.push(newValidationError("org_domain", "org_domain is required"));
	}
	if (!req.name) {
		errs.push(newValidationError("name", "name is required"));
	}
	if (!req.admin_verification_note) {
		errs.push(
			newValidationError(
				"admin_verification_note",
				"admin_verification_note is required"
			)
		);
	}
	if (!req.verification_id) {
		errs.push(
			newValidationError("verification_id", "verification_id is required")
		);
	}
	return errs;
}

export interface AdminRejectMarketplaceServiceListingRequest {
	org_domain: string;
	name: string;
	admin_verification_note: string;
	verification_id?: string;
}

export function validateAdminRejectMarketplaceServiceListingRequest(
	req: AdminRejectMarketplaceServiceListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.org_domain) {
		errs.push(newValidationError("org_domain", "org_domain is required"));
	}
	if (!req.name) {
		errs.push(newValidationError("name", "name is required"));
	}
	if (!req.admin_verification_note) {
		errs.push(
			newValidationError(
				"admin_verification_note",
				"admin_verification_note is required"
			)
		);
	}
	return errs;
}

export interface AdminSuspendMarketplaceServiceListingRequest {
	org_domain: string;
	name: string;
	admin_verification_note: string;
	verification_id?: string;
}

export function validateAdminSuspendMarketplaceServiceListingRequest(
	req: AdminSuspendMarketplaceServiceListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.org_domain) {
		errs.push(newValidationError("org_domain", "org_domain is required"));
	}
	if (!req.name) {
		errs.push(newValidationError("name", "name is required"));
	}
	if (!req.admin_verification_note) {
		errs.push(
			newValidationError(
				"admin_verification_note",
				"admin_verification_note is required"
			)
		);
	}
	return errs;
}

export interface AdminReinstateMarketplaceServiceListingRequest {
	org_domain: string;
	name: string;
	admin_verification_note?: string;
	verification_id?: string;
}

export interface AdminGrantMarketplaceAppealRequest {
	org_domain: string;
	name: string;
	admin_verification_note: string;
	verification_id?: string;
}

export function validateAdminGrantMarketplaceAppealRequest(
	req: AdminGrantMarketplaceAppealRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.org_domain) {
		errs.push(newValidationError("org_domain", "org_domain is required"));
	}
	if (!req.name) {
		errs.push(newValidationError("name", "name is required"));
	}
	if (!req.admin_verification_note) {
		errs.push(
			newValidationError(
				"admin_verification_note",
				"admin_verification_note is required"
			)
		);
	}
	return errs;
}

export interface AdminDenyMarketplaceAppealRequest {
	org_domain: string;
	name: string;
	admin_verification_note: string;
	verification_id?: string;
}

export function validateAdminDenyMarketplaceAppealRequest(
	req: AdminDenyMarketplaceAppealRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.org_domain) {
		errs.push(newValidationError("org_domain", "org_domain is required"));
	}
	if (!req.name) {
		errs.push(newValidationError("name", "name is required"));
	}
	if (!req.admin_verification_note) {
		errs.push(
			newValidationError(
				"admin_verification_note",
				"admin_verification_note is required"
			)
		);
	}
	return errs;
}
