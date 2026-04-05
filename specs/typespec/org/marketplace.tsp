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

enum MarketplaceEnrollmentStatus {
  pending_review,
  approved,
  rejected,
  suspended,
  expired,
}

enum MarketplaceOfferStatus {
  draft,
  pending_review,
  active,
  rejected,
  suspended,
  archived,
}

enum MarketplaceSubscriptionStatus {
  requested,
  provider_review,
  admin_review,
  awaiting_contract,
  awaiting_payment,
  active,
  rejected,
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
  capability_slug: string;
  display_name: string;
  description: string;
  provider_enabled: boolean;
  consumer_enabled: boolean;
  status: MarketplaceCapabilityStatus;
  pricing_hint?: string;
}

model MarketplaceEnrollment {
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

model MarketplaceOffer {
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

model MarketplaceProviderSummary {
  provider_org_domain: string;
  capability_slug: string;
  headline: string;
  summary: string;
  pricing_hint?: string;
  regions_served: string[];
  contact_mode: MarketplaceContactMode;
  contact_value: string;
}

model MarketplaceSubscription {
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

model MarketplaceIncomingSubscription {
  consumer_org_domain: string;
  capability_slug: string;
  status: MarketplaceSubscriptionStatus;
  request_note?: string;
  review_note?: string;
  updated_at: string;
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
  capability_slug: string;
}

model ListProviderEnrollmentsRequest {
  pagination_key?: string;
  limit?: int32;
}

model ListProviderEnrollmentsResponse {
  enrollments: MarketplaceEnrollment[];
  next_pagination_key?: string;
}

model GetProviderEnrollmentRequest {
  capability_slug: string;
}

model ApplyProviderEnrollmentRequest {
  capability_slug: string;
  application_note?: string;
}

model ReapplyProviderEnrollmentRequest {
  capability_slug: string;
  application_note?: string;
}

model GetProviderOfferRequest {
  capability_slug: string;
}

model CreateProviderOfferRequest {
  capability_slug: string;
  headline: string;
  summary: string;
  description: string;
  regions_served: string[];
  pricing_hint?: string;
  contact_mode: MarketplaceContactMode;
  contact_value: string;
}

model UpdateProviderOfferRequest {
  capability_slug: string;
  headline: string;
  summary: string;
  description: string;
  regions_served: string[];
  pricing_hint?: string;
  contact_mode: MarketplaceContactMode;
  contact_value: string;
}

model SubmitProviderOfferRequest {
  capability_slug: string;
}

model ArchiveProviderOfferRequest {
  capability_slug: string;
}

model ListMarketplaceProvidersRequest {
  capability_slug: string;
  pagination_key?: string;
  limit?: int32;
}

model ListMarketplaceProvidersResponse {
  providers: MarketplaceProviderSummary[];
  next_pagination_key?: string;
}

model GetMarketplaceProviderOfferRequest {
  provider_org_domain: string;
  capability_slug: string;
}

model ListConsumerSubscriptionsRequest {
  pagination_key?: string;
  limit?: int32;
}

model ListConsumerSubscriptionsResponse {
  subscriptions: MarketplaceSubscription[];
  next_pagination_key?: string;
}

model GetConsumerSubscriptionRequest {
  provider_org_domain: string;
  capability_slug: string;
}

model RequestConsumerSubscriptionRequest {
  provider_org_domain: string;
  capability_slug: string;
  request_note?: string;
}

model CancelConsumerSubscriptionRequest {
  provider_org_domain: string;
  capability_slug: string;
}

model ListIncomingSubscriptionsRequest {
  capability_slug?: string;
  pagination_key?: string;
  limit?: int32;
}

model ListIncomingSubscriptionsResponse {
  subscriptions: MarketplaceIncomingSubscription[];
  next_pagination_key?: string;
}

model GetIncomingSubscriptionRequest {
  consumer_org_domain: string;
  capability_slug: string;
}

model ProviderApproveSubscriptionRequest {
  consumer_org_domain: string;
  capability_slug: string;
}

model ProviderRejectSubscriptionRequest {
  consumer_org_domain: string;
  capability_slug: string;
  review_note: string;
}

// ---- API Routes ----

@route("/org")
interface OrgMarketplace {
  @route("/marketplace/capabilities/list") @post
  listMarketplaceCapabilities(@body body: ListMarketplaceCapabilitiesRequest): ListMarketplaceCapabilitiesResponse;

  @route("/marketplace/capabilities/get") @post
  getMarketplaceCapability(@body body: GetMarketplaceCapabilityRequest): MarketplaceCapability | NotFoundResponse;

  @route("/marketplace/provider-enrollments/list") @post
  listProviderEnrollments(@body body: ListProviderEnrollmentsRequest): ListProviderEnrollmentsResponse;

  @route("/marketplace/provider-enrollments/get") @post
  getProviderEnrollment(@body body: GetProviderEnrollmentRequest): MarketplaceEnrollment | NotFoundResponse;

  @route("/marketplace/provider-enrollments/apply") @post
  applyProviderEnrollment(@body body: ApplyProviderEnrollmentRequest): MarketplaceEnrollment | BadRequestResponse;

  @route("/marketplace/provider-enrollments/reapply") @post
  reapplyProviderEnrollment(@body body: ReapplyProviderEnrollmentRequest): MarketplaceEnrollment | BadRequestResponse;

  @route("/marketplace/provider-offers/get") @post
  getProviderOffer(@body body: GetProviderOfferRequest): MarketplaceOffer | NotFoundResponse;

  @route("/marketplace/provider-offers/create") @post
  createProviderOffer(@body body: CreateProviderOfferRequest): MarketplaceOffer | BadRequestResponse;

  @route("/marketplace/provider-offers/update") @post
  updateProviderOffer(@body body: UpdateProviderOfferRequest): MarketplaceOffer | BadRequestResponse;

  @route("/marketplace/provider-offers/submit") @post
  submitProviderOffer(@body body: SubmitProviderOfferRequest): MarketplaceOffer | BadRequestResponse;

  @route("/marketplace/provider-offers/archive") @post
  archiveProviderOffer(@body body: ArchiveProviderOfferRequest): MarketplaceOffer | BadRequestResponse;

  @route("/marketplace/providers/list") @post
  listMarketplaceProviders(@body body: ListMarketplaceProvidersRequest): ListMarketplaceProvidersResponse;

  @route("/marketplace/providers/get-offer") @post
  getMarketplaceProviderOffer(@body body: GetMarketplaceProviderOfferRequest): MarketplaceOffer | NotFoundResponse;

  @route("/marketplace/consumer-subscriptions/list") @post
  listConsumerSubscriptions(@body body: ListConsumerSubscriptionsRequest): ListConsumerSubscriptionsResponse;

  @route("/marketplace/consumer-subscriptions/get") @post
  getConsumerSubscription(@body body: GetConsumerSubscriptionRequest): MarketplaceSubscription | NotFoundResponse;

  @route("/marketplace/consumer-subscriptions/request") @post
  requestConsumerSubscription(@body body: RequestConsumerSubscriptionRequest): MarketplaceSubscription | BadRequestResponse;

  @route("/marketplace/consumer-subscriptions/cancel") @post
  cancelConsumerSubscription(@body body: CancelConsumerSubscriptionRequest): MarketplaceSubscription | BadRequestResponse;

  @route("/marketplace/incoming-subscriptions/list") @post
  listIncomingSubscriptions(@body body: ListIncomingSubscriptionsRequest): ListIncomingSubscriptionsResponse;

  @route("/marketplace/incoming-subscriptions/get") @post
  getIncomingSubscription(@body body: GetIncomingSubscriptionRequest): MarketplaceIncomingSubscription | NotFoundResponse;

  @route("/marketplace/incoming-subscriptions/provider-approve") @post
  providerApproveSubscription(@body body: ProviderApproveSubscriptionRequest): MarketplaceIncomingSubscription | BadRequestResponse;

  @route("/marketplace/incoming-subscriptions/provider-reject") @post
  providerRejectSubscription(@body body: ProviderRejectSubscriptionRequest): MarketplaceIncomingSubscription | BadRequestResponse;
}
