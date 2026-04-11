import { type ValidationError, newValidationError } from "../common/common";

// ---- Enums ----

export type MarketplaceCapabilityStatus = "draft" | "active" | "disabled";
export namespace MarketplaceCapabilityStatus {
	export const Draft: MarketplaceCapabilityStatus = "draft";
	export const Active: MarketplaceCapabilityStatus = "active";
	export const Disabled: MarketplaceCapabilityStatus = "disabled";
}

export type MarketplaceListingStatus =
	| "draft"
	| "active"
	| "suspended"
	| "archived";
export namespace MarketplaceListingStatus {
	export const Draft: MarketplaceListingStatus = "draft";
	export const Active: MarketplaceListingStatus = "active";
	export const Suspended: MarketplaceListingStatus = "suspended";
	export const Archived: MarketplaceListingStatus = "archived";
}

export type MarketplaceSubscriptionStatus = "active" | "cancelled" | "expired";
export namespace MarketplaceSubscriptionStatus {
	export const Active: MarketplaceSubscriptionStatus = "active";
	export const Cancelled: MarketplaceSubscriptionStatus = "cancelled";
	export const Expired: MarketplaceSubscriptionStatus = "expired";
}

// ---- Models ----

export interface MarketplaceCapability {
	capability_id: string;
	display_name: string;
	description: string;
	status: MarketplaceCapabilityStatus;
}

export interface MarketplaceListing {
	listing_id: string;
	org_domain: string;
	capability_id: string;
	headline: string;
	description: string;
	status: MarketplaceListingStatus;
	suspension_note?: string;
	listed_at?: string;
	created_at: string;
	updated_at: string;
}

export interface MarketplaceListingCard {
	listing_id: string;
	org_domain: string;
	capability_id: string;
	headline: string;
	description: string;
	listed_at: string;
}

export interface MarketplaceSubscription {
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

export interface MarketplaceClient {
	subscription_id: string;
	listing_id: string;
	consumer_org_domain: string;
	capability_id: string;
	request_note?: string;
	status: MarketplaceSubscriptionStatus;
	started_at: string;
	expires_at?: string;
	created_at: string;
}

// ---- Request / Response types ----

export interface ListMarketplaceCapabilitiesRequest {
	pagination_key?: string;
	limit?: number;
}

export interface ListMarketplaceCapabilitiesResponse {
	capabilities: MarketplaceCapability[];
	next_pagination_key?: string;
}

export interface GetMarketplaceCapabilityRequest {
	capability_id: string;
}

export function validateGetMarketplaceCapabilityRequest(
	req: GetMarketplaceCapabilityRequest
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
	return errs;
}

// --- Listings (provider side) ---

export interface ListMyListingsRequest {
	capability_id?: string;
	pagination_key?: string;
	limit?: number;
}

export interface ListMyListingsResponse {
	listings: MarketplaceListing[];
	next_pagination_key?: string;
}

export interface GetMyListingRequest {
	listing_id: string;
}

export function validateGetMyListingRequest(
	req: GetMyListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.listing_id) {
		errs.push(newValidationError("listing_id", "listing_id is required"));
	}
	return errs;
}

export interface CreateListingRequest {
	capability_id: string;
	headline: string;
	description: string;
}

export function validateCreateListingRequest(
	req: CreateListingRequest
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
	if (!req.headline) {
		errs.push(newValidationError("headline", "headline is required"));
	} else if (req.headline.length > 100) {
		errs.push(
			newValidationError("headline", "headline must be at most 100 characters")
		);
	}
	if (!req.description) {
		errs.push(newValidationError("description", "description is required"));
	} else if (req.description.length > 10000) {
		errs.push(
			newValidationError(
				"description",
				"description must be at most 10000 characters"
			)
		);
	}
	return errs;
}

export interface UpdateListingRequest {
	listing_id: string;
	headline: string;
	description: string;
}

export function validateUpdateListingRequest(
	req: UpdateListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.listing_id) {
		errs.push(newValidationError("listing_id", "listing_id is required"));
	}
	if (!req.headline) {
		errs.push(newValidationError("headline", "headline is required"));
	} else if (req.headline.length > 100) {
		errs.push(
			newValidationError("headline", "headline must be at most 100 characters")
		);
	}
	if (!req.description) {
		errs.push(newValidationError("description", "description is required"));
	} else if (req.description.length > 10000) {
		errs.push(
			newValidationError(
				"description",
				"description must be at most 10000 characters"
			)
		);
	}
	return errs;
}

export interface PublishListingRequest {
	listing_id: string;
}

export interface ArchiveListingRequest {
	listing_id: string;
}

// --- Discover (buyer browse) ---

export interface DiscoverListingsRequest {
	capability_id?: string;
	pagination_key?: string;
	limit?: number;
}

export interface DiscoverListingsResponse {
	listings: MarketplaceListingCard[];
	next_pagination_key?: string;
}

export interface GetListingRequest {
	listing_id: string;
}

// --- Subscriptions (consumer side) ---

export interface RequestSubscriptionRequest {
	listing_id: string;
	request_note?: string;
}

export function validateRequestSubscriptionRequest(
	req: RequestSubscriptionRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.listing_id) {
		errs.push(newValidationError("listing_id", "listing_id is required"));
	}
	if (req.request_note && req.request_note.length > 2000) {
		errs.push(
			newValidationError(
				"request_note",
				"request_note must be at most 2000 characters"
			)
		);
	}
	return errs;
}

export interface CancelSubscriptionRequest {
	subscription_id: string;
}

export interface ListSubscriptionsRequest {
	filter_status?: MarketplaceSubscriptionStatus;
	pagination_key?: string;
	limit?: number;
}

export interface ListSubscriptionsResponse {
	subscriptions: MarketplaceSubscription[];
	next_pagination_key?: string;
}

export interface GetSubscriptionRequest {
	subscription_id: string;
}

// --- Clients (provider side) ---

export interface ListClientsRequest {
	listing_id?: string;
	filter_status?: MarketplaceSubscriptionStatus;
	pagination_key?: string;
	limit?: number;
}

export interface ListClientsResponse {
	clients: MarketplaceClient[];
	next_pagination_key?: string;
}

export interface GetClientRequest {
	subscription_id: string;
}
