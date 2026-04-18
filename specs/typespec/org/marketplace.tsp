import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// ---- Capabilities (global catalog) ----

model MarketplaceCapability {
  capability_id: string;
  display_name: string;
  description: string;
  status: string; // 'draft' | 'active' | 'disabled'
}

model ListCapabilitiesResponse {
  capabilities: MarketplaceCapability[];
}

// ---- Listing ----

model MarketplaceListing {
  listing_id: string;
  org_domain: string;
  listing_number: int32;
  headline: string;
  description: string;
  capabilities: string[]; // capability_ids
  status: string; // marketplace_listing_status
  suspension_note?: string;
  rejection_note?: string;
  listed_at?: string;
  active_subscriber_count: int32;
  created_at: string;
  updated_at: string;
}

model CreateListingRequest {
  headline: string;
  description: string;
  capabilities: string[]; // min 1 max 5
}

model UpdateListingRequest {
  listing_number: int32;
  headline: string;
  description: string;
}

model GetListingRequest {
  org_domain: string;
  listing_number: int32;
}

model ListMyListingsRequest {
  filter_status?: string;
  pagination_key?: string;
  limit?: int32;
}

model ListMyListingsResponse {
  listings: MarketplaceListing[];
  next_pagination_key?: string;
}

model PublishListingRequest {
  listing_number: int32;
}

model ArchiveListingRequest {
  listing_number: int32;
}

model ReopenListingRequest {
  listing_number: int32;
}

model AddListingCapabilityRequest {
  listing_number: int32;
  capability_id: string;
}

model RemoveListingCapabilityRequest {
  listing_number: int32;
  capability_id: string;
}

// ---- Discovery ----

model DiscoverListingsRequest {
  capability_id?: string;
  search_text?: string;
  pagination_key?: string;
  limit?: int32;
}

model ListingCard {
  listing_id: string;
  org_domain: string;
  listing_number: int32;
  headline: string;
  description: string;
  capability_ids: string[];
  listed_at: string;
}

model DiscoverListingsResponse {
  listings: ListingCard[];
  next_pagination_key?: string;
}

// ---- Subscriptions ----

model MarketplaceSubscription {
  subscription_id: string;
  listing_id: string;
  provider_org_domain: string;
  provider_listing_number: int32;
  consumer_org_domain: string;
  request_note: string;
  status: string; // marketplace_subscription_status
  started_at: string;
  expires_at?: string;
  cancelled_at?: string;
  created_at: string;
  updated_at: string;
}

model SubscribeRequest {
  provider_org_domain: string;
  provider_listing_number: int32;
  request_note?: string;
}

model CancelSubscriptionRequest {
  subscription_id: string;
}

model GetSubscriptionRequest {
  provider_org_domain: string;
  provider_listing_number: int32;
}

model ListMySubscriptionsRequest {
  filter_status?: string;
  pagination_key?: string;
  limit?: int32;
}

model ListMySubscriptionsResponse {
  subscriptions: MarketplaceSubscription[];
  next_pagination_key?: string;
}

model MarketplaceClient {
  subscription_id: string;
  consumer_org_domain: string;
  listing_number: int32;
  request_note: string;
  status: string;
  started_at: string;
}

model ListMyClientsRequest {
  listing_number?: int32;
  pagination_key?: string;
  limit?: int32;
}

model ListMyClientsResponse {
  clients: MarketplaceClient[];
  next_pagination_key?: string;
}

// ---- Admin ----

model AdminCreateCapabilityRequest {
  capability_id: string;
  display_name: string;
  description?: string;
}

model AdminUpdateCapabilityRequest {
  capability_id: string;
  status: string;
  display_name?: string;
  description?: string;
}

model AdminListListingsRequest {
  filter_org_domain?: string;
  filter_capability_id?: string;
  filter_status?: string;
  pagination_key?: string;
  limit?: int32;
}

model AdminListListingsResponse {
  listings: MarketplaceListing[];
  next_pagination_key?: string;
}

model AdminSuspendListingRequest {
  org_domain: string;
  listing_number: int32;
  suspension_note: string;
}

model AdminReinstateListingRequest {
  org_domain: string;
  listing_number: int32;
}

model AdminApproveListingRequest {
  org_domain: string;
  listing_number: int32;
}

model AdminRejectListingRequest {
  org_domain: string;
  listing_number: int32;
  rejection_note: string;
}

model AdminListSubscriptionsRequest {
  filter_provider_org_domain?: string;
  filter_status?: string;
  pagination_key?: string;
  limit?: int32;
}

model AdminListSubscriptionsResponse {
  subscriptions: MarketplaceSubscription[];
  next_pagination_key?: string;
}

model AdminCancelSubscriptionRequest {
  subscription_id: string;
}
