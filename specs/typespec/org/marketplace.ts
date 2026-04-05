import { type ValidationError, newValidationError } from "../common/common";

// ---- Enums ----

export type MarketplaceCapabilityStatus = "draft" | "active" | "disabled";
export namespace MarketplaceCapabilityStatus {
	export const Draft: MarketplaceCapabilityStatus = "draft";
	export const Active: MarketplaceCapabilityStatus = "active";
	export const Disabled: MarketplaceCapabilityStatus = "disabled";
}

export type MarketplaceEnrollmentStatus =
	| "pending_review"
	| "approved"
	| "rejected"
	| "suspended"
	| "expired";
export namespace MarketplaceEnrollmentStatus {
	export const PendingReview: MarketplaceEnrollmentStatus = "pending_review";
	export const Approved: MarketplaceEnrollmentStatus = "approved";
	export const Rejected: MarketplaceEnrollmentStatus = "rejected";
	export const Suspended: MarketplaceEnrollmentStatus = "suspended";
	export const Expired: MarketplaceEnrollmentStatus = "expired";
}

export type MarketplaceOfferStatus =
	| "draft"
	| "pending_review"
	| "active"
	| "rejected"
	| "suspended"
	| "archived";
export namespace MarketplaceOfferStatus {
	export const Draft: MarketplaceOfferStatus = "draft";
	export const PendingReview: MarketplaceOfferStatus = "pending_review";
	export const Active: MarketplaceOfferStatus = "active";
	export const Rejected: MarketplaceOfferStatus = "rejected";
	export const Suspended: MarketplaceOfferStatus = "suspended";
	export const Archived: MarketplaceOfferStatus = "archived";
}

export type MarketplaceSubscriptionStatus =
	| "requested"
	| "provider_review"
	| "admin_review"
	| "awaiting_contract"
	| "awaiting_payment"
	| "active"
	| "rejected"
	| "cancelled"
	| "expired";
export namespace MarketplaceSubscriptionStatus {
	export const Requested: MarketplaceSubscriptionStatus = "requested";
	export const ProviderReview: MarketplaceSubscriptionStatus =
		"provider_review";
	export const AdminReview: MarketplaceSubscriptionStatus = "admin_review";
	export const AwaitingContract: MarketplaceSubscriptionStatus =
		"awaiting_contract";
	export const AwaitingPayment: MarketplaceSubscriptionStatus =
		"awaiting_payment";
	export const Active: MarketplaceSubscriptionStatus = "active";
	export const Rejected: MarketplaceSubscriptionStatus = "rejected";
	export const Cancelled: MarketplaceSubscriptionStatus = "cancelled";
	export const Expired: MarketplaceSubscriptionStatus = "expired";
}

export type MarketplaceContactMode =
	| "platform_message"
	| "external_url"
	| "email";
export namespace MarketplaceContactMode {
	export const PlatformMessage: MarketplaceContactMode = "platform_message";
	export const ExternalUrl: MarketplaceContactMode = "external_url";
	export const Email: MarketplaceContactMode = "email";
}

// ---- Models ----

export interface MarketplaceCapability {
	capability_slug: string;
	display_name: string;
	description: string;
	provider_enabled: boolean;
	consumer_enabled: boolean;
	status: MarketplaceCapabilityStatus;
	pricing_hint?: string;
}

export interface MarketplaceEnrollment {
	capability_slug: string;
	status: MarketplaceEnrollmentStatus;
	application_note?: string;
	review_note?: string;
	approved_at?: string;
	expires_at?: string;
	billing_status: string;
	created_at: string;
	updated_at: string;
}

export interface MarketplaceOffer {
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

export interface MarketplaceProviderSummary {
	provider_org_domain: string;
	capability_slug: string;
	headline: string;
	summary: string;
	pricing_hint?: string;
	regions_served: string[];
	contact_mode: MarketplaceContactMode;
	contact_value: string;
}

export interface MarketplaceSubscription {
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

export interface MarketplaceIncomingSubscription {
	consumer_org_domain: string;
	capability_slug: string;
	status: MarketplaceSubscriptionStatus;
	request_note?: string;
	review_note?: string;
	updated_at: string;
	created_at: string;
}

// ---- Request/Response types ----

export interface ListMarketplaceCapabilitiesRequest {
	pagination_key?: string;
	limit?: number;
}

export interface ListMarketplaceCapabilitiesResponse {
	capabilities: MarketplaceCapability[];
	next_pagination_key?: string;
}

export interface GetMarketplaceCapabilityRequest {
	capability_slug: string;
}

export function validateGetMarketplaceCapabilityRequest(
	req: GetMarketplaceCapabilityRequest
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
	return errs;
}

export interface ListProviderEnrollmentsRequest {
	pagination_key?: string;
	limit?: number;
}

export interface ListProviderEnrollmentsResponse {
	enrollments: MarketplaceEnrollment[];
	next_pagination_key?: string;
}

export interface GetProviderEnrollmentRequest {
	capability_slug: string;
}

export interface ApplyProviderEnrollmentRequest {
	capability_slug: string;
	application_note?: string;
}

export function validateApplyProviderEnrollmentRequest(
	req: ApplyProviderEnrollmentRequest
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
	return errs;
}

export interface ReapplyProviderEnrollmentRequest {
	capability_slug: string;
	application_note?: string;
}

export interface GetProviderOfferRequest {
	capability_slug: string;
}

export interface CreateProviderOfferRequest {
	capability_slug: string;
	headline: string;
	summary: string;
	description: string;
	regions_served: string[];
	pricing_hint?: string;
	contact_mode: MarketplaceContactMode;
	contact_value: string;
}

export function validateCreateProviderOfferRequest(
	req: CreateProviderOfferRequest
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
	if (!req.headline) {
		errs.push(newValidationError("headline", "headline is required"));
	}
	if (!req.summary) {
		errs.push(newValidationError("summary", "summary is required"));
	}
	if (!req.description) {
		errs.push(newValidationError("description", "description is required"));
	}
	if (!req.regions_served || req.regions_served.length === 0) {
		errs.push(
			newValidationError("regions_served", "at least one region is required")
		);
	}
	if (!req.contact_value) {
		errs.push(newValidationError("contact_value", "contact_value is required"));
	}
	return errs;
}

export interface UpdateProviderOfferRequest {
	capability_slug: string;
	headline: string;
	summary: string;
	description: string;
	regions_served: string[];
	pricing_hint?: string;
	contact_mode: MarketplaceContactMode;
	contact_value: string;
}

export interface SubmitProviderOfferRequest {
	capability_slug: string;
}

export interface ArchiveProviderOfferRequest {
	capability_slug: string;
}

export interface ListMarketplaceProvidersRequest {
	capability_slug: string;
	pagination_key?: string;
	limit?: number;
}

export interface ListMarketplaceProvidersResponse {
	providers: MarketplaceProviderSummary[];
	next_pagination_key?: string;
}

export interface GetMarketplaceProviderOfferRequest {
	provider_org_domain: string;
	capability_slug: string;
}

export interface ListConsumerSubscriptionsRequest {
	pagination_key?: string;
	limit?: number;
}

export interface ListConsumerSubscriptionsResponse {
	subscriptions: MarketplaceSubscription[];
	next_pagination_key?: string;
}

export interface GetConsumerSubscriptionRequest {
	provider_org_domain: string;
	capability_slug: string;
}

export interface RequestConsumerSubscriptionRequest {
	provider_org_domain: string;
	capability_slug: string;
	request_note?: string;
}

export function validateRequestConsumerSubscriptionRequest(
	req: RequestConsumerSubscriptionRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.provider_org_domain) {
		errs.push(
			newValidationError(
				"provider_org_domain",
				"provider_org_domain is required"
			)
		);
	}
	if (!req.capability_slug || req.capability_slug.length < 3) {
		errs.push(
			newValidationError(
				"capability_slug",
				"capability_slug must be at least 3 characters"
			)
		);
	}
	return errs;
}

export interface CancelConsumerSubscriptionRequest {
	provider_org_domain: string;
	capability_slug: string;
}

export interface ListIncomingSubscriptionsRequest {
	capability_slug?: string;
	pagination_key?: string;
	limit?: number;
}

export interface ListIncomingSubscriptionsResponse {
	subscriptions: MarketplaceIncomingSubscription[];
	next_pagination_key?: string;
}

export interface GetIncomingSubscriptionRequest {
	consumer_org_domain: string;
	capability_slug: string;
}

export interface ProviderApproveSubscriptionRequest {
	consumer_org_domain: string;
	capability_slug: string;
}

export interface ProviderRejectSubscriptionRequest {
	consumer_org_domain: string;
	capability_slug: string;
	review_note: string;
}

export function validateProviderRejectSubscriptionRequest(
	req: ProviderRejectSubscriptionRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.consumer_org_domain) {
		errs.push(
			newValidationError(
				"consumer_org_domain",
				"consumer_org_domain is required"
			)
		);
	}
	if (!req.review_note) {
		errs.push(newValidationError("review_note", "review_note is required"));
	}
	return errs;
}
