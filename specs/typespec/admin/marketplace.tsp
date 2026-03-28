import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// ---- Admin Capability endpoints ----

model ListMarketplaceProviderCapabilitiesRequest {
  filter_status?: OrgCapabilityStatus;
  filter_org_id?: string;
  cursor?: string;
  limit?: int32;
}

model ListMarketplaceProviderCapabilitiesResponse {
  capabilities: OrgCapability[];
  next_cursor?: string;
}

model ApproveMarketplaceProviderCapabilityRequest {
  org_id: string;
  subscription_price: float64;
  currency: string;
  subscription_period_days: int32;
}

model RejectMarketplaceProviderCapabilityRequest {
  org_id: string;
  admin_note: string;
}

model RenewMarketplaceProviderCapabilityRequest {
  org_id: string;
  subscription_price: float64;
  currency: string;
  subscription_period_days: int32;
}

model RevokeMarketplaceProviderCapabilityRequest {
  org_id: string;
  admin_note: string;
}

model ReinstateMarketplaceProviderCapabilityRequest {
  org_id: string;
  subscription_price: float64;
  currency: string;
  subscription_period_days: int32;
}

// ---- Admin ServiceListing endpoints ----

model AdminListMarketplaceServiceListingsRequest {
  filter_state?: ServiceListingState;
  filter_org_id?: string;
  has_reports?: boolean;
  cursor?: string;
  limit?: int32;
}

model AdminListMarketplaceServiceListingsResponse {
  service_listings: ServiceListing[];
  next_cursor?: string;
}

model AdminGetMarketplaceServiceListingRequest {
  service_listing_id: string;
  home_region: string;
}

model AdminApproveMarketplaceServiceListingRequest {
  service_listing_id: string;
  home_region: string;
  admin_verification_note: string;
  verification_id: string;
}

model AdminRejectMarketplaceServiceListingRequest {
  service_listing_id: string;
  home_region: string;
  admin_verification_note: string;
  verification_id?: string;
}

model AdminSuspendMarketplaceServiceListingRequest {
  service_listing_id: string;
  home_region: string;
  admin_verification_note: string;
  verification_id?: string;
}

model AdminReinstateMarketplaceServiceListingRequest {
  service_listing_id: string;
  home_region: string;
  admin_verification_note: string;
  verification_id?: string;
}

model AdminGrantMarketplaceAppealRequest {
  service_listing_id: string;
  home_region: string;
  admin_verification_note: string;
  verification_id?: string;
}

model AdminDenyMarketplaceAppealRequest {
  service_listing_id: string;
  home_region: string;
  admin_verification_note: string;
  verification_id?: string;
}

// ---- API Routes ----

@route("/admin")
interface AdminMarketplace {
  @route("/list-marketplace-provider-capabilities") @post
  listMarketplaceProviderCapabilities(@body body: ListMarketplaceProviderCapabilitiesRequest): ListMarketplaceProviderCapabilitiesResponse;

  @route("/approve-marketplace-provider-capability") @post
  approveMarketplaceProviderCapability(@body body: ApproveMarketplaceProviderCapabilityRequest): OrgCapability | BadRequestResponse;

  @route("/reject-marketplace-provider-capability") @post
  rejectMarketplaceProviderCapability(@body body: RejectMarketplaceProviderCapabilityRequest): OrgCapability | BadRequestResponse;

  @route("/renew-marketplace-provider-capability") @post
  renewMarketplaceProviderCapability(@body body: RenewMarketplaceProviderCapabilityRequest): OrgCapability | BadRequestResponse;

  @route("/revoke-marketplace-provider-capability") @post
  revokeMarketplaceProviderCapability(@body body: RevokeMarketplaceProviderCapabilityRequest): OrgCapability | BadRequestResponse;

  @route("/reinstate-marketplace-provider-capability") @post
  reinstateMarketplaceProviderCapability(@body body: ReinstateMarketplaceProviderCapabilityRequest): OrgCapability | BadRequestResponse;

  @route("/list-marketplace-service-listings") @post
  listAdminMarketplaceServiceListings(@body body: AdminListMarketplaceServiceListingsRequest): AdminListMarketplaceServiceListingsResponse;

  @route("/get-marketplace-service-listing") @post
  getAdminMarketplaceServiceListing(@body body: AdminGetMarketplaceServiceListingRequest): ServiceListing | NotFoundResponse;

  @route("/approve-marketplace-service-listing") @post
  approveMarketplaceServiceListing(@body body: AdminApproveMarketplaceServiceListingRequest): ServiceListing | BadRequestResponse;

  @route("/reject-marketplace-service-listing") @post
  rejectMarketplaceServiceListing(@body body: AdminRejectMarketplaceServiceListingRequest): ServiceListing | BadRequestResponse;

  @route("/suspend-marketplace-service-listing") @post
  suspendMarketplaceServiceListing(@body body: AdminSuspendMarketplaceServiceListingRequest): ServiceListing | BadRequestResponse;

  @route("/reinstate-marketplace-service-listing") @post
  reinstateMarketplaceServiceListing(@body body: AdminReinstateMarketplaceServiceListingRequest): ServiceListing | BadRequestResponse;

  @route("/grant-marketplace-appeal") @post
  grantMarketplaceAppeal(@body body: AdminGrantMarketplaceAppealRequest): ServiceListing | BadRequestResponse;

  @route("/deny-marketplace-appeal") @post
  denyMarketplaceAppeal(@body body: AdminDenyMarketplaceAppealRequest): ServiceListing | BadRequestResponse;
}
