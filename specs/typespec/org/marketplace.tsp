import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// ---- Enums ----

enum OrgCapabilityStatus {
  pending_approval,
  active,
  rejected,
  expired,
  revoked,
}

enum ServiceListingState {
  draft,
  pending_review,
  active,
  paused,
  rejected,
  suspended,
  appealing,
  archived,
}

enum ServiceCategory {
  talent_sourcing,
}

enum CompanySize {
  startup,
  smb,
  enterprise,
}

enum SeniorityLevel {
  intern,
  junior,
  mid,
  senior,
  lead,
  director,
  c_suite,
}

enum Industry {
  technology_software,
  finance_banking,
  healthcare_life_sciences,
  manufacturing_engineering,
  retail_consumer_goods,
  media_entertainment,
  education_training,
  legal_services,
  consulting_professional_services,
  real_estate_construction,
  energy_utilities,
  logistics_supply_chain,
  government_public_sector,
  nonprofit_ngo,
  other,
}

enum JobFunction {
  engineering_technology,
  sales_business_development,
  marketing,
  finance_accounting,
  human_resources,
  operations_supply_chain,
  product_management,
  design_creative,
  legal_compliance,
  customer_success_support,
  data_analytics,
  executive_general_management,
}

enum ReportReason {
  misleading_information,
  fraudulent,
  inappropriate_content,
  spam,
  other,
}

// ---- Models ----

model OrgCapability {
  org_id: string;
  capability: string;
  status: OrgCapabilityStatus;
  application_note?: string;
  applied_at?: string;
  admin_note?: string;
  subscription_price?: string;
  currency?: string;
  granted_at?: string;
  expires_at?: string;
  created_at: string;
}

model ServiceListingFields {
  name: string;
  short_blurb: string;
  description: string;
  service_category: ServiceCategory;
  countries_of_service: CountryCode[];
  contact_url: string;
  pricing_info?: string;
  industries_served: Industry[];
  industries_served_other?: string;
  company_sizes_served: CompanySize[];
  job_functions_sourced: JobFunction[];
  seniority_levels_sourced: SeniorityLevel[];
  geographic_sourcing_regions: CountryCode[];
}

model ServiceListingSummary {
  service_listing_id: string;
  home_region: string;
  org_id: string;
  name: string;
  short_blurb: string;
  logo_url?: string;
  org_name: string;
  service_category: ServiceCategory;
  countries_of_service: CountryCode[];
  created_at: string;
}

model ServiceListing {
  service_listing_id: string;
  org_id: string;
  name: string;
  short_blurb: string;
  description: string;
  service_category: ServiceCategory;
  countries_of_service: CountryCode[];
  contact_url: string;
  pricing_info?: string;
  state: ServiceListingState;
  appeal_exhausted: boolean;
  last_activated_at?: string;
  industries_served: string[];
  industries_served_other?: string;
  company_sizes_served: string[];
  job_functions_sourced: string[];
  seniority_levels_sourced: string[];
  geographic_sourcing_regions: CountryCode[];
  last_review_admin_note?: string;
  appeal_reason?: string;
  appeal_admin_note?: string;
  created_at: string;
  updated_at: string;
}

// ---- Capability requests ----

model ApplyMarketplaceProviderCapabilityRequest {
  application_note?: string;
}

model CreateMarketplaceServiceListingRequest extends ServiceListingFields {}

model CreateMarketplaceServiceListingResponse {
  service_listing_id: string;
}

model UpdateMarketplaceServiceListingRequest extends ServiceListingFields {
  service_listing_id: string;
}

model SubmitMarketplaceServiceListingRequest {
  service_listing_id: string;
}

model PauseMarketplaceServiceListingRequest {
  service_listing_id: string;
}

model UnpauseMarketplaceServiceListingRequest {
  service_listing_id: string;
}

model ArchiveMarketplaceServiceListingRequest {
  service_listing_id: string;
}

model SubmitMarketplaceServiceListingAppealRequest {
  service_listing_id: string;
  appeal_reason: string;
}

model ListMarketplaceServiceListingsRequest {
  filter_state?: ServiceListingState;
  cursor?: string;
  limit?: int32;
}

model ListMarketplaceServiceListingsResponse {
  service_listings: ServiceListing[];
  next_cursor?: string;
}

model GetMarketplaceServiceListingRequest {
  service_listing_id: string;
}

model BrowseMarketplaceServiceListingsRequest {
  keyword?: string;
  service_category?: ServiceCategory;
  industries?: Industry[];
  company_sizes?: CompanySize[];
  job_functions?: JobFunction[];
  seniority_levels?: SeniorityLevel[];
  countries_of_service?: CountryCode[];
  geographic_sourcing_regions?: CountryCode[];
  cursor?: string;
  limit?: int32;
}

model BrowseMarketplaceServiceListingsResponse {
  service_listings: ServiceListingSummary[];
  next_cursor?: string;
}

model GetPublicMarketplaceServiceListingRequest {
  service_listing_id: string;
  home_region: string;
}

model ReportMarketplaceServiceListingRequest {
  service_listing_id: string;
  home_region: string;
  reason: ReportReason;
  reason_other?: string;
}

// ---- API Routes ----

@route("/org")
interface OrgMarketplace {
  @route("/apply-marketplace-provider-capability") @post
  applyMarketplaceProviderCapability(@body body: ApplyMarketplaceProviderCapabilityRequest): OrgCapability | BadRequestResponse;

  @route("/get-marketplace-provider-capability") @post
  getMarketplaceProviderCapability(): OrgCapability | NotFoundResponse;

  @route("/create-marketplace-service-listing") @post
  createMarketplaceServiceListing(@body body: CreateMarketplaceServiceListingRequest): CreateMarketplaceServiceListingResponse | BadRequestResponse;

  @route("/update-marketplace-service-listing") @post
  updateMarketplaceServiceListing(@body body: UpdateMarketplaceServiceListingRequest): ServiceListing | BadRequestResponse;

  @route("/submit-marketplace-service-listing") @post
  submitMarketplaceServiceListing(@body body: SubmitMarketplaceServiceListingRequest): ServiceListing | BadRequestResponse;

  @route("/pause-marketplace-service-listing") @post
  pauseMarketplaceServiceListing(@body body: PauseMarketplaceServiceListingRequest): ServiceListing | BadRequestResponse;

  @route("/unpause-marketplace-service-listing") @post
  unpauseMarketplaceServiceListing(@body body: UnpauseMarketplaceServiceListingRequest): ServiceListing | BadRequestResponse;

  @route("/archive-marketplace-service-listing") @post
  archiveMarketplaceServiceListing(@body body: ArchiveMarketplaceServiceListingRequest): ServiceListing | BadRequestResponse;

  @route("/submit-marketplace-service-listing-appeal") @post
  submitMarketplaceServiceListingAppeal(@body body: SubmitMarketplaceServiceListingAppealRequest): ServiceListing | BadRequestResponse;

  @route("/list-marketplace-service-listings") @post
  listMarketplaceServiceListings(@body body: ListMarketplaceServiceListingsRequest): ListMarketplaceServiceListingsResponse;

  @route("/get-marketplace-service-listing") @post
  getMarketplaceServiceListing(@body body: GetMarketplaceServiceListingRequest): ServiceListing | NotFoundResponse;

  @route("/browse-marketplace-service-listings") @post
  browseMarketplaceServiceListings(@body body: BrowseMarketplaceServiceListingsRequest): BrowseMarketplaceServiceListingsResponse;

  @route("/get-public-marketplace-service-listing") @post
  getPublicMarketplaceServiceListing(@body body: GetPublicMarketplaceServiceListingRequest): ServiceListing | NotFoundResponse;

  @route("/report-marketplace-service-listing") @post
  reportMarketplaceServiceListing(@body body: ReportMarketplaceServiceListingRequest): NoContentResponse | BadRequestResponse;
}
