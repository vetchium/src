import { type ValidationError, newValidationError } from "../common/common";
import type {
	MarketplaceCapabilityStatus,
	MarketplaceContactMode,
	MarketplaceEnrollmentStatus,
	MarketplaceOfferStatus,
	MarketplaceSubscriptionStatus,
} from "../org/marketplace";

// ---- Models ----

export interface AdminMarketplaceCapability {
	capability_slug: string;
	display_name: string;
	description: string;
	provider_enabled: boolean;
	consumer_enabled: boolean;
	enrollment_approval: string;
	offer_review: string;
	subscription_approval: string;
	contract_required: boolean;
	payment_required: boolean;
	pricing_hint?: string;
	status: MarketplaceCapabilityStatus;
	created_at: string;
	updated_at: string;
}

export interface AdminMarketplaceEnrollment {
	org_domain: string;
	capability_slug: string;
	status: MarketplaceEnrollmentStatus;
	application_note?: string;
	review_note?: string;
	approved_at?: string;
	expires_at?: string;
	billing_reference?: string;
	billing_status: string;
	created_at: string;
	updated_at: string;
}

export interface AdminMarketplaceOffer {
	org_domain: string;
	capability_slug: string;
	headline: string;
	summary: string;
	description: string;
	regions_served: string[];
	pricing_hint?: string;
	contact_mode: MarketplaceContactMode;
	contact_value: string;
	status: MarketplaceOfferStatus;
	review_note?: string;
	created_at: string;
	updated_at: string;
}

export interface AdminMarketplaceSubscription {
	consumer_org_domain: string;
	provider_org_domain: string;
	capability_slug: string;
	request_note?: string;
	status: MarketplaceSubscriptionStatus;
	review_note?: string;
	requires_provider_review: boolean;
	requires_admin_review: boolean;
	requires_contract: boolean;
	requires_payment: boolean;
	starts_at?: string;
	expires_at?: string;
	created_at: string;
	updated_at: string;
}

export interface AdminBillingRecord {
	consumer_org_domain: string;
	provider_org_domain: string;
	capability_slug: string;
	event_type: string;
	note?: string;
	created_at: string;
}

// ---- Capability Catalog request types ----

export interface AdminListCapabilitiesRequest {
	pagination_key?: string;
	limit?: number;
}

export interface AdminListCapabilitiesResponse {
	capabilities: AdminMarketplaceCapability[];
	next_pagination_key?: string;
}

export interface AdminGetCapabilityRequest {
	capability_slug: string;
}

export interface AdminCreateCapabilityRequest {
	capability_slug: string;
	display_name: string;
	description: string;
	provider_enabled: boolean;
	consumer_enabled: boolean;
	enrollment_approval: string;
	offer_review: string;
	subscription_approval: string;
	contract_required: boolean;
	payment_required: boolean;
	pricing_hint?: string;
}

export function validateAdminCreateCapabilityRequest(
	req: AdminCreateCapabilityRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.capability_slug || req.capability_slug.length < 3) {
		errs.push(
			newValidationError(
				"capability_slug",
				"capability_slug must be at least 3 characters"
			)
		);
	}
	if (!req.display_name) {
		errs.push(newValidationError("display_name", "display_name is required"));
	}
	if (!["open", "manual"].includes(req.enrollment_approval)) {
		errs.push(
			newValidationError(
				"enrollment_approval",
				"enrollment_approval must be 'open' or 'manual'"
			)
		);
	}
	if (!["auto", "manual"].includes(req.offer_review)) {
		errs.push(
			newValidationError(
				"offer_review",
				"offer_review must be 'auto' or 'manual'"
			)
		);
	}
	if (
		!["direct", "provider", "admin", "provider_and_admin"].includes(
			req.subscription_approval
		)
	) {
		errs.push(
			newValidationError(
				"subscription_approval",
				"subscription_approval must be 'direct', 'provider', 'admin', or 'provider_and_admin'"
			)
		);
	}
	return errs;
}

export interface AdminUpdateCapabilityRequest {
	capability_slug: string;
	display_name: string;
	description: string;
	provider_enabled: boolean;
	consumer_enabled: boolean;
	enrollment_approval: string;
	offer_review: string;
	subscription_approval: string;
	contract_required: boolean;
	payment_required: boolean;
	pricing_hint?: string;
}

export interface AdminEnableCapabilityRequest {
	capability_slug: string;
}

export interface AdminDisableCapabilityRequest {
	capability_slug: string;
}

// ---- Enrollment request types ----

export interface AdminListEnrollmentsRequest {
	filter_org_domain?: string;
	filter_capability_slug?: string;
	filter_status?: MarketplaceEnrollmentStatus;
	pagination_key?: string;
	limit?: number;
}

export interface AdminListEnrollmentsResponse {
	enrollments: AdminMarketplaceEnrollment[];
	next_pagination_key?: string;
}

export interface AdminGetEnrollmentRequest {
	org_domain: string;
	capability_slug: string;
}

export interface AdminApproveEnrollmentRequest {
	org_domain: string;
	capability_slug: string;
	expires_at?: string;
	billing_reference?: string;
	review_note?: string;
}

export interface AdminRejectEnrollmentRequest {
	org_domain: string;
	capability_slug: string;
	review_note: string;
}

export interface AdminSuspendEnrollmentRequest {
	org_domain: string;
	capability_slug: string;
	review_note: string;
}

export interface AdminReinstateEnrollmentRequest {
	org_domain: string;
	capability_slug: string;
}

export interface AdminRenewEnrollmentRequest {
	org_domain: string;
	capability_slug: string;
	expires_at?: string;
	billing_reference?: string;
	review_note?: string;
}

// ---- Offer request types ----

export interface AdminListOffersRequest {
	filter_org_domain?: string;
	filter_capability_slug?: string;
	filter_status?: MarketplaceOfferStatus;
	pagination_key?: string;
	limit?: number;
}

export interface AdminListOffersResponse {
	offers: AdminMarketplaceOffer[];
	next_pagination_key?: string;
}

export interface AdminGetOfferRequest {
	org_domain: string;
	capability_slug: string;
}

export interface AdminApproveOfferRequest {
	org_domain: string;
	capability_slug: string;
	review_note?: string;
}

export interface AdminRejectOfferRequest {
	org_domain: string;
	capability_slug: string;
	review_note: string;
}

export interface AdminSuspendOfferRequest {
	org_domain: string;
	capability_slug: string;
	review_note: string;
}

export interface AdminReinstateOfferRequest {
	org_domain: string;
	capability_slug: string;
}

// ---- Subscription request types ----

export interface AdminListSubscriptionsRequest {
	filter_consumer_org_domain?: string;
	filter_provider_org_domain?: string;
	filter_capability_slug?: string;
	filter_status?: MarketplaceSubscriptionStatus;
	pagination_key?: string;
	limit?: number;
}

export interface AdminListSubscriptionsResponse {
	subscriptions: AdminMarketplaceSubscription[];
	next_pagination_key?: string;
}

export interface AdminGetSubscriptionRequest {
	consumer_org_domain: string;
	provider_org_domain: string;
	capability_slug: string;
}

export interface AdminApproveSubscriptionRequest {
	consumer_org_domain: string;
	provider_org_domain: string;
	capability_slug: string;
	review_note?: string;
}

export interface AdminRejectSubscriptionRequest {
	consumer_org_domain: string;
	provider_org_domain: string;
	capability_slug: string;
	review_note: string;
}

export interface AdminMarkContractSignedRequest {
	consumer_org_domain: string;
	provider_org_domain: string;
	capability_slug: string;
	note?: string;
}

export interface AdminWaiveContractRequest {
	consumer_org_domain: string;
	provider_org_domain: string;
	capability_slug: string;
	note: string;
}

export interface AdminRecordPaymentRequest {
	consumer_org_domain: string;
	provider_org_domain: string;
	capability_slug: string;
	note?: string;
}

export interface AdminWaivePaymentRequest {
	consumer_org_domain: string;
	provider_org_domain: string;
	capability_slug: string;
	note: string;
}

export interface AdminCancelSubscriptionRequest {
	consumer_org_domain: string;
	provider_org_domain: string;
	capability_slug: string;
}

// ---- Billing request types ----

export interface AdminListBillingRequest {
	filter_consumer_org_domain?: string;
	filter_provider_org_domain?: string;
	filter_capability_slug?: string;
	pagination_key?: string;
	limit?: number;
}

export interface AdminListBillingResponse {
	records: AdminBillingRecord[];
	next_pagination_key?: string;
}
