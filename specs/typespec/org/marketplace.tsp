import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// ---- Enums ----

enum MarketplaceCapabilityStatus {
  draft,
  active,
  disabled,
}

enum MarketplaceListingStatus {
  draft,
  active,
  suspended,
  archived,
}

enum MarketplaceSubscriptionStatus {
  active,
  cancelled,
  expired,
}

enum MarketplaceContactMode {
  platform_message,
  external_url,
  email,
}

// ---- Models ----

model MarketplaceCapability {
  capability_id: string;
  display_name: string;
  description: string;
  status: MarketplaceCapabilityStatus;
}

// Full listing (provider's own view or buyer's detail view)
model MarketplaceListing {
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

// Browse card (subset of fields for listing discovery)
model MarketplaceListingCard {
  listing_id: string;
  org_domain: string;
  capability_id: string;
  headline: string;
  summary: string;
  regions_served: string[];
  pricing_hint?: string;
  contact_mode: MarketplaceContactMode;
  contact_value: string;
  listed_at: string;
}

model MarketplaceSubscription {
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

// Provider's view of a consumer who subscribed to their listing
model MarketplaceClient {
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

// ---- Request/Response types ----

model ListMarketplaceCapabilitiesRequest {
  pagination_key?: string;
  limit?: int32;
}

model ListMarketplaceCapabilitiesResponse {
  capabilities: MarketplaceCapability[];
  next_pagination_key?: string;
}

model GetMarketplaceCapabilityRequest {
  capability_id: string;
}

// Provider: list own listings
model ListMyListingsRequest {
  capability_id?: string;
  pagination_key?: string;
  limit?: int32;
}

model ListMyListingsResponse {
  listings: MarketplaceListing[];
  next_pagination_key?: string;
}

model GetMyListingRequest {
  listing_id: string;
}

model CreateListingRequest {
  capability_id: string;
  headline: string;
  summary: string;
  description: string;
  regions_served: string[];
  pricing_hint?: string;
  contact_mode: MarketplaceContactMode;
  contact_value: string;
}

model UpdateListingRequest {
  listing_id: string;
  headline: string;
  summary: string;
  description: string;
  regions_served: string[];
  pricing_hint?: string;
  contact_mode: MarketplaceContactMode;
  contact_value: string;
}

model PublishListingRequest {
  listing_id: string;
}

model ArchiveListingRequest {
  listing_id: string;
}

// Discovery: buyer browse
model DiscoverListingsRequest {
  capability_id?: string;
  pagination_key?: string;
  limit?: int32;
}

model DiscoverListingsResponse {
  listings: MarketplaceListingCard[];
  next_pagination_key?: string;
}

model GetListingRequest {
  listing_id: string;
}

// Consumer subscriptions
model RequestSubscriptionRequest {
  listing_id: string;
  request_note?: string;
}

model CancelSubscriptionRequest {
  subscription_id: string;
}

model ListSubscriptionsRequest {
  filter_status?: MarketplaceSubscriptionStatus;
  pagination_key?: string;
  limit?: int32;
}

model ListSubscriptionsResponse {
  subscriptions: MarketplaceSubscription[];
  next_pagination_key?: string;
}

model GetSubscriptionRequest {
  subscription_id: string;
}

// Provider: client view
model ListClientsRequest {
  listing_id?: string;
  filter_status?: MarketplaceSubscriptionStatus;
  pagination_key?: string;
  limit?: int32;
}

model ListClientsResponse {
  clients: MarketplaceClient[];
  next_pagination_key?: string;
}

model GetClientRequest {
  subscription_id: string;
}

// ---- API Routes ----

@route("/org")
interface OrgMarketplace {
  // Capability catalog (any authenticated org user)
  @route("/marketplace/capabilities/list") @post
  listMarketplaceCapabilities(@body body: ListMarketplaceCapabilitiesRequest): ListMarketplaceCapabilitiesResponse;

  @route("/marketplace/capabilities/get") @post
  getMarketplaceCapability(@body body: GetMarketplaceCapabilityRequest): MarketplaceCapability | NotFoundResponse;

  // Provider: own listings
  @route("/marketplace/listings/list") @post
  listMyListings(@body body: ListMyListingsRequest): ListMyListingsResponse;

  @route("/marketplace/listings/get") @post
  getMyListing(@body body: GetMyListingRequest): MarketplaceListing | NotFoundResponse;

  @route("/marketplace/listings/create") @post
  createListing(@body body: CreateListingRequest): MarketplaceListing | BadRequestResponse;

  @route("/marketplace/listings/update") @post
  updateListing(@body body: UpdateListingRequest): MarketplaceListing | BadRequestResponse;

  @route("/marketplace/listings/publish") @post
  publishListing(@body body: PublishListingRequest): MarketplaceListing | BadRequestResponse;

  @route("/marketplace/listings/archive") @post
  archiveListing(@body body: ArchiveListingRequest): MarketplaceListing | BadRequestResponse;

  // Discovery: buyer browse (any authenticated org user)
  @route("/marketplace/discover/list") @post
  discoverListings(@body body: DiscoverListingsRequest): DiscoverListingsResponse;

  @route("/marketplace/discover/get") @post
  getListing(@body body: GetListingRequest): MarketplaceListing | NotFoundResponse;

  // Consumer subscriptions
  @route("/marketplace/subscriptions/request") @post
  requestSubscription(@body body: RequestSubscriptionRequest): MarketplaceSubscription | BadRequestResponse;

  @route("/marketplace/subscriptions/cancel") @post
  cancelSubscription(@body body: CancelSubscriptionRequest): MarketplaceSubscription | BadRequestResponse;

  @route("/marketplace/subscriptions/list") @post
  listSubscriptions(@body body: ListSubscriptionsRequest): ListSubscriptionsResponse;

  @route("/marketplace/subscriptions/get") @post
  getSubscription(@body body: GetSubscriptionRequest): MarketplaceSubscription | NotFoundResponse;

  // Provider: client view
  @route("/marketplace/clients/list") @post
  listClients(@body body: ListClientsRequest): ListClientsResponse;

  @route("/marketplace/clients/get") @post
  getClient(@body body: GetClientRequest): MarketplaceClient | NotFoundResponse;
}
