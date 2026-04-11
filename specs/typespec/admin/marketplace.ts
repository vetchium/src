import { type ValidationError, newValidationError } from "../common/common";
import type {
	MarketplaceCapabilityStatus,
	MarketplaceListingStatus,
	MarketplaceSubscriptionStatus,
	MarketplaceContactMode,
} from "../org/marketplace";

// ---- Admin models ----

export interface AdminMarketplaceCapability {
	capability_id: string;
	status: MarketplaceCapabilityStatus;
	translations: AdminCapabilityTranslation[];
	created_at: string;
	updated_at: string;
}

export interface AdminCapabilityTranslation {
	locale: string;
	display_name: string;
	description: string;
}

export interface AdminMarketplaceListing {
	listing_id: string;
	org_domain: string;
	capability_id: string;
	headline: string;
	summary: string;
	description: string;
	regions_served: string[];
	pricing_hint?: string;
	contact_mode: MarketplaceContactMode;
	contact_value: string;
	status: MarketplaceListingStatus;
	suspension_note?: string;
	listed_at?: string;
	created_at: string;
	updated_at: string;
}

export interface AdminMarketplaceSubscription {
	subscription_id: string;
	listing_id: string;
	consumer_org_domain: string;
	provider_org_domain: string;
	capability_id: string;
	request_note?: string;
	status: MarketplaceSubscriptionStatus;
	started_at: string;
	expires_at?: string;
	cancelled_at?: string;
	created_at: string;
	updated_at: string;
}

export interface AdminBillingRecord {
	consumer_org_domain: string;
	provider_org_domain: string;
	capability_id: string;
	event_type: string;
	note?: string;
	created_at: string;
}

// ---- Request/Response types ----

export interface AdminListCapabilitiesRequest {
	pagination_key?: string;
	limit?: number;
}

export interface AdminListCapabilitiesResponse {
	capabilities: AdminMarketplaceCapability[];
	next_pagination_key?: string;
}

export interface AdminGetCapabilityRequest {
	capability_id: string;
}

export interface AdminCreateCapabilityRequest {
	capability_id: string;
	status: MarketplaceCapabilityStatus;
	translations: AdminCapabilityTranslation[];
}

export function validateAdminCreateCapabilityRequest(
	req: AdminCreateCapabilityRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.capability_id || req.capability_id.length < 3) {
		errs.push(
			newValidationError(
				"capability_id",
				"capability_id must be at least 3 characters"
			)
		);
	}
	if (!req.translations || req.translations.length === 0) {
		errs.push(
			newValidationError("translations", "at least one translation is required")
		);
	} else {
		const hasEnUS = req.translations.some((t) => t.locale === "en-US");
		if (!hasEnUS) {
			errs.push(
				newValidationError("translations", "en-US translation is required")
			);
		}
	}
	return errs;
}

export interface AdminUpdateCapabilityRequest {
	capability_id: string;
	translations: AdminCapabilityTranslation[];
}

export function validateAdminUpdateCapabilityRequest(
	req: AdminUpdateCapabilityRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.capability_id) {
		errs.push(newValidationError("capability_id", "capability_id is required"));
	}
	if (!req.translations || req.translations.length === 0) {
		errs.push(
			newValidationError("translations", "at least one translation is required")
		);
	}
	return errs;
}

export interface AdminEnableCapabilityRequest {
	capability_id: string;
}

export interface AdminDisableCapabilityRequest {
	capability_id: string;
}

export interface AdminListListingsRequest {
	capability_id?: string;
	org_domain?: string;
	filter_status?: MarketplaceListingStatus;
	pagination_key?: string;
	limit?: number;
}

export interface AdminListListingsResponse {
	listings: AdminMarketplaceListing[];
	next_pagination_key?: string;
}

export interface AdminGetListingRequest {
	listing_id: string;
}

export interface AdminSuspendListingRequest {
	listing_id: string;
	suspension_note: string;
}

export function validateAdminSuspendListingRequest(
	req: AdminSuspendListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.listing_id) {
		errs.push(newValidationError("listing_id", "listing_id is required"));
	}
	if (!req.suspension_note) {
		errs.push(
			newValidationError("suspension_note", "suspension_note is required")
		);
	}
	return errs;
}

export interface AdminReinstateListingRequest {
	listing_id: string;
}

export interface AdminApproveListingRequest {
	listing_id: string;
}

export interface AdminListSubscriptionsRequest {
	capability_id?: string;
	org_domain?: string;
	filter_status?: MarketplaceSubscriptionStatus;
	pagination_key?: string;
	limit?: number;
}

export interface AdminListSubscriptionsResponse {
	subscriptions: AdminMarketplaceSubscription[];
	next_pagination_key?: string;
}

export interface AdminGetSubscriptionRequest {
	subscription_id: string;
}

export interface AdminCancelSubscriptionRequest {
	subscription_id: string;
}

export interface AdminListBillingRequest {
	capability_id?: string;
	org_domain?: string;
	pagination_key?: string;
	limit?: number;
}

export interface AdminListBillingResponse {
	records: AdminBillingRecord[];
	next_pagination_key?: string;
}
