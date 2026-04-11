import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";
import "../org/marketplace.tsp";

using TypeSpec.Http;

namespace Vetchium;

// ---- Admin role constants ----

// (role values defined in roles.ts / roles.go)

// ---- Admin models ----

model AdminMarketplaceCapability {
  capability_id: string;
  status: MarketplaceCapabilityStatus;
  translations: AdminCapabilityTranslation[];
  created_at: string;
  updated_at: string;
}

model AdminCapabilityTranslation {
  locale: string;
  display_name: string;
  description: string;
}

model AdminMarketplaceListing {
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

model AdminMarketplaceSubscription {
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

model AdminBillingRecord {
  consumer_org_domain: string;
  provider_org_domain: string;
  capability_id: string;
  event_type: string;
  note?: string;
  created_at: string;
}

// ---- Request/Response types ----

model AdminListCapabilitiesRequest {
  pagination_key?: string;
  limit?: int32;
}

model AdminListCapabilitiesResponse {
  capabilities: AdminMarketplaceCapability[];
  next_pagination_key?: string;
}

model AdminGetCapabilityRequest {
  capability_id: string;
}

model AdminCreateCapabilityRequest {
  capability_id: string;
  status: MarketplaceCapabilityStatus;
  translations: AdminCapabilityTranslation[];
}

model AdminUpdateCapabilityRequest {
  capability_id: string;
  translations: AdminCapabilityTranslation[];
}

model AdminEnableCapabilityRequest {
  capability_id: string;
}

model AdminDisableCapabilityRequest {
  capability_id: string;
}

model AdminListListingsRequest {
  capability_id?: string;
  org_domain?: string;
  filter_status?: MarketplaceListingStatus;
  pagination_key?: string;
  limit?: int32;
}

model AdminListListingsResponse {
  listings: AdminMarketplaceListing[];
  next_pagination_key?: string;
}

model AdminGetListingRequest {
  listing_id: string;
}

model AdminSuspendListingRequest {
  listing_id: string;
  suspension_note: string;
}

model AdminReinstateListingRequest {
  listing_id: string;
}

model AdminApproveListingRequest {
  listing_id: string;
}

model AdminListSubscriptionsRequest {
  capability_id?: string;
  org_domain?: string;
  filter_status?: MarketplaceSubscriptionStatus;
  pagination_key?: string;
  limit?: int32;
}

model AdminListSubscriptionsResponse {
  subscriptions: AdminMarketplaceSubscription[];
  next_pagination_key?: string;
}

model AdminGetSubscriptionRequest {
  subscription_id: string;
}

model AdminCancelSubscriptionRequest {
  subscription_id: string;
}

model AdminListBillingRequest {
  capability_id?: string;
  org_domain?: string;
  pagination_key?: string;
  limit?: int32;
}

model AdminListBillingResponse {
  records: AdminBillingRecord[];
  next_pagination_key?: string;
}

// ---- API Routes ----

@route("/admin")
interface AdminMarketplace {
  // Capability management
  @route("/marketplace/capabilities/list") @post
  adminListCapabilities(@body body: AdminListCapabilitiesRequest): AdminListCapabilitiesResponse;

  @route("/marketplace/capabilities/get") @post
  adminGetCapability(@body body: AdminGetCapabilityRequest): AdminMarketplaceCapability | NotFoundResponse;

  @route("/marketplace/capabilities/create") @post
  adminCreateCapability(@body body: AdminCreateCapabilityRequest): AdminMarketplaceCapability | BadRequestResponse;

  @route("/marketplace/capabilities/update") @post
  adminUpdateCapability(@body body: AdminUpdateCapabilityRequest): AdminMarketplaceCapability | BadRequestResponse;

  @route("/marketplace/capabilities/enable") @post
  adminEnableCapability(@body body: AdminEnableCapabilityRequest): AdminMarketplaceCapability | BadRequestResponse;

  @route("/marketplace/capabilities/disable") @post
  adminDisableCapability(@body body: AdminDisableCapabilityRequest): AdminMarketplaceCapability | BadRequestResponse;

  // Listing oversight
  @route("/marketplace/listings/list") @post
  adminListListings(@body body: AdminListListingsRequest): AdminListListingsResponse;

  @route("/marketplace/listings/get") @post
  adminGetListing(@body body: AdminGetListingRequest): AdminMarketplaceListing | NotFoundResponse;

  @route("/marketplace/listings/suspend") @post
  adminSuspendListing(@body body: AdminSuspendListingRequest): AdminMarketplaceListing | BadRequestResponse;

  @route("/marketplace/listings/reinstate") @post
  adminReinstateListing(@body body: AdminReinstateListingRequest): AdminMarketplaceListing | BadRequestResponse;

  @route("/marketplace/listings/approve") @post
  adminApproveListing(@body body: AdminApproveListingRequest): AdminMarketplaceListing | BadRequestResponse;

  // Subscription oversight
  @route("/marketplace/subscriptions/list") @post
  adminListSubscriptions(@body body: AdminListSubscriptionsRequest): AdminListSubscriptionsResponse;

  @route("/marketplace/subscriptions/get") @post
  adminGetSubscription(@body body: AdminGetSubscriptionRequest): AdminMarketplaceSubscription | NotFoundResponse;

  @route("/marketplace/subscriptions/cancel") @post
  adminCancelSubscription(@body body: AdminCancelSubscriptionRequest): AdminMarketplaceSubscription | BadRequestResponse;

  // Billing management
  @route("/marketplace/billing/list") @post
  adminListBilling(@body body: AdminListBillingRequest): AdminListBillingResponse;
}
