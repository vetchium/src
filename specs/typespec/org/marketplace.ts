import { newValidationError, type ValidationError } from "../common/common";

export type MarketplaceListingStatus =
	| "draft"
	| "pending_review"
	| "active"
	| "suspended"
	| "archived";

export type MarketplaceSubscriptionStatus = "active" | "cancelled" | "expired";

export type CapabilityStatus = "draft" | "active" | "disabled";

export interface MarketplaceCapability {
	capability_id: string;
	display_name: string;
	description: string;
	status: CapabilityStatus;
}

export interface ListCapabilitiesResponse {
	capabilities: MarketplaceCapability[];
}

export interface MarketplaceListing {
	listing_id: string;
	org_domain: string;
	listing_number: number;
	headline: string;
	description: string;
	capabilities: string[];
	status: MarketplaceListingStatus;
	suspension_note?: string;
	rejection_note?: string;
	listed_at?: string;
	active_subscriber_count: number;
	created_at: string;
	updated_at: string;
	is_subscribed: boolean;
}

export interface CreateListingRequest {
	headline: string;
	description: string;
	capabilities: string[];
}

export interface UpdateListingRequest {
	listing_number: number;
	headline: string;
	description: string;
}

export interface GetListingRequest {
	org_domain: string;
	listing_number: number;
}

export interface ListMyListingsRequest {
	filter_status?: MarketplaceListingStatus;
	pagination_key?: string;
	limit?: number;
}

export interface ListMyListingsResponse {
	listings: MarketplaceListing[];
	next_pagination_key?: string;
}

export interface PublishListingRequest {
	listing_number: number;
}

export interface ArchiveListingRequest {
	listing_number: number;
}

export interface ReopenListingRequest {
	listing_number: number;
}

export interface AddListingCapabilityRequest {
	listing_number: number;
	capability_id: string;
}

export interface RemoveListingCapabilityRequest {
	listing_number: number;
	capability_id: string;
}

export interface DiscoverListingsRequest {
	capability_id?: string;
	search_text?: string;
	pagination_key?: string;
	limit?: number;
}

export interface ListingCard {
	listing_id: string;
	org_domain: string;
	listing_number: number;
	headline: string;
	description: string;
	capability_ids: string[];
	listed_at: string;
	is_subscribed: boolean;
}

export interface DiscoverListingsResponse {
	listings: ListingCard[];
	next_pagination_key?: string;
}

export interface MarketplaceSubscription {
	subscription_id: string;
	listing_id: string;
	provider_org_domain: string;
	provider_listing_number: number;
	consumer_org_domain: string;
	request_note: string;
	status: MarketplaceSubscriptionStatus;
	started_at: string;
	expires_at?: string;
	cancelled_at?: string;
	created_at: string;
	updated_at: string;
}

export interface SubscribeRequest {
	provider_org_domain: string;
	provider_listing_number: number;
	request_note?: string;
}

export interface CancelSubscriptionRequest {
	subscription_id: string;
}

export interface GetSubscriptionRequest {
	provider_org_domain: string;
	provider_listing_number: number;
}

export interface ListMySubscriptionsRequest {
	filter_status?: MarketplaceSubscriptionStatus;
	pagination_key?: string;
	limit?: number;
}

export interface ListMySubscriptionsResponse {
	subscriptions: MarketplaceSubscription[];
	next_pagination_key?: string;
}

export interface MarketplaceClient {
	subscription_id: string;
	consumer_org_domain: string;
	listing_number: number;
	request_note: string;
	status: MarketplaceSubscriptionStatus;
	started_at: string;
}

export interface ListMyClientsRequest {
	listing_number?: number;
	pagination_key?: string;
	limit?: number;
}

export interface ListMyClientsResponse {
	clients: MarketplaceClient[];
	next_pagination_key?: string;
}

export interface AdminCreateCapabilityRequest {
	capability_id: string;
	display_name: string;
	description?: string;
}

export interface AdminUpdateCapabilityRequest {
	capability_id: string;
	status: CapabilityStatus;
	display_name?: string;
	description?: string;
}

export interface AdminListListingsRequest {
	filter_org_domain?: string;
	filter_capability_id?: string;
	filter_status?: MarketplaceListingStatus;
	pagination_key?: string;
	limit?: number;
}

export interface AdminListListingsResponse {
	listings: MarketplaceListing[];
	next_pagination_key?: string;
}

export interface AdminSuspendListingRequest {
	org_domain: string;
	listing_number: number;
	suspension_note: string;
}

export interface AdminReinstateListingRequest {
	org_domain: string;
	listing_number: number;
}

export interface AdminApproveListingRequest {
	org_domain: string;
	listing_number: number;
}

export interface AdminRejectListingRequest {
	org_domain: string;
	listing_number: number;
	rejection_note: string;
}

export interface AdminListSubscriptionsRequest {
	filter_provider_org_domain?: string;
	filter_status?: MarketplaceSubscriptionStatus;
	pagination_key?: string;
	limit?: number;
}

export interface AdminListSubscriptionsResponse {
	subscriptions: MarketplaceSubscription[];
	next_pagination_key?: string;
}

export interface AdminCancelSubscriptionRequest {
	subscription_id: string;
}

const VALID_LISTING_STATUSES: MarketplaceListingStatus[] = [
	"draft",
	"pending_review",
	"active",
	"suspended",
	"archived",
];

const VALID_SUBSCRIPTION_STATUSES: MarketplaceSubscriptionStatus[] = [
	"active",
	"cancelled",
	"expired",
];

const VALID_CAPABILITY_STATUSES: CapabilityStatus[] = [
	"draft",
	"active",
	"disabled",
];

export function validateCreateListingRequest(
	req: CreateListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.headline || req.headline.length === 0) {
		errs.push(newValidationError("headline", "headline is required"));
	} else if (req.headline.length > 100) {
		errs.push(newValidationError("headline", "must be at most 100 characters"));
	}
	if (!req.description || req.description.length === 0) {
		errs.push(newValidationError("description", "description is required"));
	} else if (req.description.length > 10000) {
		errs.push(
			newValidationError("description", "must be at most 10000 characters")
		);
	}
	if (!req.capabilities || req.capabilities.length === 0) {
		errs.push(
			newValidationError("capabilities", "at least one capability is required")
		);
	} else if (req.capabilities.length > 5) {
		errs.push(
			newValidationError("capabilities", "at most 5 capabilities allowed")
		);
	}
	return errs;
}

export function validateUpdateListingRequest(
	req: UpdateListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.listing_number || req.listing_number < 1) {
		errs.push(
			newValidationError("listing_number", "listing_number is required")
		);
	}
	if (!req.headline || req.headline.length === 0) {
		errs.push(newValidationError("headline", "headline is required"));
	} else if (req.headline.length > 100) {
		errs.push(newValidationError("headline", "must be at most 100 characters"));
	}
	if (!req.description || req.description.length === 0) {
		errs.push(newValidationError("description", "description is required"));
	} else if (req.description.length > 10000) {
		errs.push(
			newValidationError("description", "must be at most 10000 characters")
		);
	}
	return errs;
}

export function validateGetListingRequest(
	req: GetListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.org_domain) {
		errs.push(newValidationError("org_domain", "org_domain is required"));
	}
	if (!req.listing_number || req.listing_number < 1) {
		errs.push(
			newValidationError("listing_number", "listing_number is required")
		);
	}
	return errs;
}

export function validateListMyListingsRequest(
	req: ListMyListingsRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (
		req.filter_status !== undefined &&
		!VALID_LISTING_STATUSES.includes(req.filter_status)
	) {
		errs.push(
			newValidationError("filter_status", "must be a valid listing status")
		);
	}
	if (req.limit !== undefined && (req.limit < 1 || req.limit > 100)) {
		errs.push(newValidationError("limit", "must be between 1 and 100"));
	}
	return errs;
}

export function validatePublishListingRequest(
	req: PublishListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.listing_number || req.listing_number < 1) {
		errs.push(
			newValidationError("listing_number", "listing_number is required")
		);
	}
	return errs;
}

export function validateArchiveListingRequest(
	req: ArchiveListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.listing_number || req.listing_number < 1) {
		errs.push(
			newValidationError("listing_number", "listing_number is required")
		);
	}
	return errs;
}

export function validateReopenListingRequest(
	req: ReopenListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.listing_number || req.listing_number < 1) {
		errs.push(
			newValidationError("listing_number", "listing_number is required")
		);
	}
	return errs;
}

export function validateAddListingCapabilityRequest(
	req: AddListingCapabilityRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.listing_number || req.listing_number < 1) {
		errs.push(
			newValidationError("listing_number", "listing_number is required")
		);
	}
	if (!req.capability_id) {
		errs.push(newValidationError("capability_id", "capability_id is required"));
	}
	return errs;
}

export function validateRemoveListingCapabilityRequest(
	req: RemoveListingCapabilityRequest
): ValidationError[] {
	return validateAddListingCapabilityRequest(req);
}

export function validateDiscoverListingsRequest(
	req: DiscoverListingsRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (req.limit !== undefined && (req.limit < 1 || req.limit > 100)) {
		errs.push(newValidationError("limit", "must be between 1 and 100"));
	}
	return errs;
}

export function validateSubscribeRequest(
	req: SubscribeRequest
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
	if (!req.provider_listing_number || req.provider_listing_number < 1) {
		errs.push(
			newValidationError(
				"provider_listing_number",
				"provider_listing_number is required"
			)
		);
	}
	if (req.request_note !== undefined && req.request_note.length > 2000) {
		errs.push(
			newValidationError("request_note", "must be at most 2000 characters")
		);
	}
	return errs;
}

export function validateCancelSubscriptionRequest(
	req: CancelSubscriptionRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.subscription_id) {
		errs.push(
			newValidationError("subscription_id", "subscription_id is required")
		);
	}
	return errs;
}

export function validateGetSubscriptionRequest(
	req: GetSubscriptionRequest
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
	if (!req.provider_listing_number || req.provider_listing_number < 1) {
		errs.push(
			newValidationError(
				"provider_listing_number",
				"provider_listing_number is required"
			)
		);
	}
	return errs;
}

export function validateListMySubscriptionsRequest(
	req: ListMySubscriptionsRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (
		req.filter_status !== undefined &&
		!VALID_SUBSCRIPTION_STATUSES.includes(req.filter_status)
	) {
		errs.push(
			newValidationError("filter_status", "must be a valid subscription status")
		);
	}
	if (req.limit !== undefined && (req.limit < 1 || req.limit > 100)) {
		errs.push(newValidationError("limit", "must be between 1 and 100"));
	}
	return errs;
}

export function validateListMyClientsRequest(
	req: ListMyClientsRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (req.limit !== undefined && (req.limit < 1 || req.limit > 100)) {
		errs.push(newValidationError("limit", "must be between 1 and 100"));
	}
	return errs;
}

export function validateAdminCreateCapabilityRequest(
	req: AdminCreateCapabilityRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.capability_id) {
		errs.push(newValidationError("capability_id", "capability_id is required"));
	} else if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(req.capability_id)) {
		errs.push(
			newValidationError(
				"capability_id",
				"must be 3-50 lowercase alphanumeric chars or hyphens, not starting/ending with hyphen"
			)
		);
	}
	if (!req.display_name) {
		errs.push(newValidationError("display_name", "display_name is required"));
	}
	return errs;
}

export function validateAdminUpdateCapabilityRequest(
	req: AdminUpdateCapabilityRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.capability_id) {
		errs.push(newValidationError("capability_id", "capability_id is required"));
	}
	if (!VALID_CAPABILITY_STATUSES.includes(req.status)) {
		errs.push(
			newValidationError("status", "must be a valid capability status")
		);
	}
	return errs;
}

export function validateAdminListListingsRequest(
	req: AdminListListingsRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (
		req.filter_status !== undefined &&
		!VALID_LISTING_STATUSES.includes(req.filter_status)
	) {
		errs.push(
			newValidationError("filter_status", "must be a valid listing status")
		);
	}
	if (req.limit !== undefined && (req.limit < 1 || req.limit > 100)) {
		errs.push(newValidationError("limit", "must be between 1 and 100"));
	}
	return errs;
}

export function validateAdminSuspendListingRequest(
	req: AdminSuspendListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.org_domain) {
		errs.push(newValidationError("org_domain", "org_domain is required"));
	}
	if (!req.listing_number || req.listing_number < 1) {
		errs.push(
			newValidationError("listing_number", "listing_number is required")
		);
	}
	if (!req.suspension_note) {
		errs.push(
			newValidationError("suspension_note", "suspension_note is required")
		);
	} else if (req.suspension_note.length > 2000) {
		errs.push(
			newValidationError("suspension_note", "must be at most 2000 characters")
		);
	}
	return errs;
}

export function validateAdminReinstateListingRequest(
	req: AdminReinstateListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.org_domain) {
		errs.push(newValidationError("org_domain", "org_domain is required"));
	}
	if (!req.listing_number || req.listing_number < 1) {
		errs.push(
			newValidationError("listing_number", "listing_number is required")
		);
	}
	return errs;
}

export function validateAdminApproveListingRequest(
	req: AdminApproveListingRequest
): ValidationError[] {
	return validateAdminReinstateListingRequest(req);
}

export function validateAdminRejectListingRequest(
	req: AdminRejectListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.org_domain) {
		errs.push(newValidationError("org_domain", "org_domain is required"));
	}
	if (!req.listing_number || req.listing_number < 1) {
		errs.push(
			newValidationError("listing_number", "listing_number is required")
		);
	}
	if (!req.rejection_note) {
		errs.push(
			newValidationError("rejection_note", "rejection_note is required")
		);
	} else if (req.rejection_note.length > 2000) {
		errs.push(
			newValidationError("rejection_note", "must be at most 2000 characters")
		);
	}
	return errs;
}

export function validateAdminListSubscriptionsRequest(
	req: AdminListSubscriptionsRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (
		req.filter_status !== undefined &&
		!VALID_SUBSCRIPTION_STATUSES.includes(req.filter_status)
	) {
		errs.push(
			newValidationError("filter_status", "must be a valid subscription status")
		);
	}
	if (req.limit !== undefined && (req.limit < 1 || req.limit > 100)) {
		errs.push(newValidationError("limit", "must be between 1 and 100"));
	}
	return errs;
}

export function validateAdminCancelSubscriptionRequest(
	req: AdminCancelSubscriptionRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.subscription_id) {
		errs.push(
			newValidationError("subscription_id", "subscription_id is required")
		);
	}
	return errs;
}
