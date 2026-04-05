import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";
import "../org/marketplace.tsp";

using TypeSpec.Http;

namespace Vetchium;

// ---- Models ----

model AdminMarketplaceCapability {
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

model AdminMarketplaceEnrollment {
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

model AdminMarketplaceOffer {
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

model AdminMarketplaceSubscription {
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

model AdminBillingRecord {
  consumer_org_domain: string;
  provider_org_domain: string;
  capability_slug: string;
  event_type: string;
  note?: string;
  created_at: string;
}

// ---- Capability Catalog Requests ----

model AdminListCapabilitiesRequest {
  pagination_key?: string;
  limit?: int32;
}

model AdminListCapabilitiesResponse {
  capabilities: AdminMarketplaceCapability[];
  next_pagination_key?: string;
}

model AdminGetCapabilityRequest {
  capability_slug: string;
}

model AdminCreateCapabilityRequest {
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

model AdminUpdateCapabilityRequest {
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

model AdminEnableCapabilityRequest {
  capability_slug: string;
}

model AdminDisableCapabilityRequest {
  capability_slug: string;
}

// ---- Enrollment Requests ----

model AdminListEnrollmentsRequest {
  filter_org_domain?: string;
  filter_capability_slug?: string;
  filter_status?: MarketplaceEnrollmentStatus;
  pagination_key?: string;
  limit?: int32;
}

model AdminListEnrollmentsResponse {
  enrollments: AdminMarketplaceEnrollment[];
  next_pagination_key?: string;
}

model AdminGetEnrollmentRequest {
  org_domain: string;
  capability_slug: string;
}

model AdminApproveEnrollmentRequest {
  org_domain: string;
  capability_slug: string;
  expires_at?: string;
  billing_reference?: string;
  review_note?: string;
}

model AdminRejectEnrollmentRequest {
  org_domain: string;
  capability_slug: string;
  review_note: string;
}

model AdminSuspendEnrollmentRequest {
  org_domain: string;
  capability_slug: string;
  review_note: string;
}

model AdminReinstateEnrollmentRequest {
  org_domain: string;
  capability_slug: string;
}

model AdminRenewEnrollmentRequest {
  org_domain: string;
  capability_slug: string;
  expires_at?: string;
  billing_reference?: string;
  review_note?: string;
}

// ---- Offer Requests ----

model AdminListOffersRequest {
  filter_org_domain?: string;
  filter_capability_slug?: string;
  filter_status?: MarketplaceOfferStatus;
  pagination_key?: string;
  limit?: int32;
}

model AdminListOffersResponse {
  offers: AdminMarketplaceOffer[];
  next_pagination_key?: string;
}

model AdminGetOfferRequest {
  org_domain: string;
  capability_slug: string;
}

model AdminApproveOfferRequest {
  org_domain: string;
  capability_slug: string;
  review_note?: string;
}

model AdminRejectOfferRequest {
  org_domain: string;
  capability_slug: string;
  review_note: string;
}

model AdminSuspendOfferRequest {
  org_domain: string;
  capability_slug: string;
  review_note: string;
}

model AdminReinstateOfferRequest {
  org_domain: string;
  capability_slug: string;
}

// ---- Subscription Requests ----

model AdminListSubscriptionsRequest {
  filter_consumer_org_domain?: string;
  filter_provider_org_domain?: string;
  filter_capability_slug?: string;
  filter_status?: MarketplaceSubscriptionStatus;
  pagination_key?: string;
  limit?: int32;
}

model AdminListSubscriptionsResponse {
  subscriptions: AdminMarketplaceSubscription[];
  next_pagination_key?: string;
}

model AdminGetSubscriptionRequest {
  consumer_org_domain: string;
  provider_org_domain: string;
  capability_slug: string;
}

model AdminApproveSubscriptionRequest {
  consumer_org_domain: string;
  provider_org_domain: string;
  capability_slug: string;
  review_note?: string;
}

model AdminRejectSubscriptionRequest {
  consumer_org_domain: string;
  provider_org_domain: string;
  capability_slug: string;
  review_note: string;
}

model AdminMarkContractSignedRequest {
  consumer_org_domain: string;
  provider_org_domain: string;
  capability_slug: string;
  note?: string;
}

model AdminWaiveContractRequest {
  consumer_org_domain: string;
  provider_org_domain: string;
  capability_slug: string;
  note: string;
}

model AdminRecordPaymentRequest {
  consumer_org_domain: string;
  provider_org_domain: string;
  capability_slug: string;
  note?: string;
}

model AdminWaivePaymentRequest {
  consumer_org_domain: string;
  provider_org_domain: string;
  capability_slug: string;
  note: string;
}

model AdminCancelSubscriptionRequest {
  consumer_org_domain: string;
  provider_org_domain: string;
  capability_slug: string;
}

// ---- Billing Requests ----

model AdminListBillingRequest {
  filter_consumer_org_domain?: string;
  filter_provider_org_domain?: string;
  filter_capability_slug?: string;
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
  // Capability catalog
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

  // Enrollments
  @route("/marketplace/provider-enrollments/list") @post
  adminListEnrollments(@body body: AdminListEnrollmentsRequest): AdminListEnrollmentsResponse;

  @route("/marketplace/provider-enrollments/get") @post
  adminGetEnrollment(@body body: AdminGetEnrollmentRequest): AdminMarketplaceEnrollment | NotFoundResponse;

  @route("/marketplace/provider-enrollments/approve") @post
  adminApproveEnrollment(@body body: AdminApproveEnrollmentRequest): AdminMarketplaceEnrollment | BadRequestResponse;

  @route("/marketplace/provider-enrollments/reject") @post
  adminRejectEnrollment(@body body: AdminRejectEnrollmentRequest): AdminMarketplaceEnrollment | BadRequestResponse;

  @route("/marketplace/provider-enrollments/suspend") @post
  adminSuspendEnrollment(@body body: AdminSuspendEnrollmentRequest): AdminMarketplaceEnrollment | BadRequestResponse;

  @route("/marketplace/provider-enrollments/reinstate") @post
  adminReinstateEnrollment(@body body: AdminReinstateEnrollmentRequest): AdminMarketplaceEnrollment | BadRequestResponse;

  @route("/marketplace/provider-enrollments/renew") @post
  adminRenewEnrollment(@body body: AdminRenewEnrollmentRequest): AdminMarketplaceEnrollment | BadRequestResponse;

  // Provider offers
  @route("/marketplace/provider-offers/list") @post
  adminListOffers(@body body: AdminListOffersRequest): AdminListOffersResponse;

  @route("/marketplace/provider-offers/get") @post
  adminGetOffer(@body body: AdminGetOfferRequest): AdminMarketplaceOffer | NotFoundResponse;

  @route("/marketplace/provider-offers/approve") @post
  adminApproveOffer(@body body: AdminApproveOfferRequest): AdminMarketplaceOffer | BadRequestResponse;

  @route("/marketplace/provider-offers/reject") @post
  adminRejectOffer(@body body: AdminRejectOfferRequest): AdminMarketplaceOffer | BadRequestResponse;

  @route("/marketplace/provider-offers/suspend") @post
  adminSuspendOffer(@body body: AdminSuspendOfferRequest): AdminMarketplaceOffer | BadRequestResponse;

  @route("/marketplace/provider-offers/reinstate") @post
  adminReinstateOffer(@body body: AdminReinstateOfferRequest): AdminMarketplaceOffer | BadRequestResponse;

  // Consumer subscriptions
  @route("/marketplace/consumer-subscriptions/list") @post
  adminListSubscriptions(@body body: AdminListSubscriptionsRequest): AdminListSubscriptionsResponse;

  @route("/marketplace/consumer-subscriptions/get") @post
  adminGetSubscription(@body body: AdminGetSubscriptionRequest): AdminMarketplaceSubscription | NotFoundResponse;

  @route("/marketplace/consumer-subscriptions/approve") @post
  adminApproveSubscription(@body body: AdminApproveSubscriptionRequest): AdminMarketplaceSubscription | BadRequestResponse;

  @route("/marketplace/consumer-subscriptions/reject") @post
  adminRejectSubscription(@body body: AdminRejectSubscriptionRequest): AdminMarketplaceSubscription | BadRequestResponse;

  @route("/marketplace/consumer-subscriptions/mark-contract-signed") @post
  adminMarkContractSigned(@body body: AdminMarkContractSignedRequest): AdminMarketplaceSubscription | BadRequestResponse;

  @route("/marketplace/consumer-subscriptions/waive-contract") @post
  adminWaiveContract(@body body: AdminWaiveContractRequest): AdminMarketplaceSubscription | BadRequestResponse;

  @route("/marketplace/consumer-subscriptions/record-payment") @post
  adminRecordPayment(@body body: AdminRecordPaymentRequest): AdminMarketplaceSubscription | BadRequestResponse;

  @route("/marketplace/consumer-subscriptions/waive-payment") @post
  adminWaivePayment(@body body: AdminWaivePaymentRequest): AdminMarketplaceSubscription | BadRequestResponse;

  @route("/marketplace/consumer-subscriptions/cancel") @post
  adminCancelSubscription(@body body: AdminCancelSubscriptionRequest): AdminMarketplaceSubscription | BadRequestResponse;

  // Billing
  @route("/marketplace/billing/list") @post
  adminListBilling(@body body: AdminListBillingRequest): AdminListBillingResponse;
}
