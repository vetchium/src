import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../common/pagination.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/billing.tsp";
import "../../problem/orgs/suspension.tsp";
import "./billing.tsp";
import "./plans.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs;

model ScheduledPlanChange {
  plan_oid: OrgPlanOID;

  /** Absent when the scheduled plan is `org-free-tier`. */
  billing_interval?: OrgBillingInterval;
}

/** A charge for one period. Amounts are not part of the contract: while
 * payments are simulated the portal owns the display prices. */
model OrgInvoice {
  @format("uuid")
  invoice_id: string;

  plan_oid: OrgPlanOID;
  billing_interval: OrgBillingInterval;
  period_start: utcDateTime;
  period_end: utcDateTime;
  reason: OrgInvoiceReason;
  state: OrgInvoiceState;
  created_at: utcDateTime;

  /** Present while the invoice is open: when unpaid users stop being served. */
  due_at?: utcDateTime;

  paid_at?: utcDateTime;

  /** Present while the invoice is open. */
  last_failure?: OrgInvoiceFailure;

  attempt_count: int32;
}

model OrgPaymentMethod {
  kind: OrgPaymentMethodKind;
}

model OrgSubscription {
  plan_oid: OrgPlanOID;

  /** Present exactly when the plan is paid. */
  billing_interval?: OrgBillingInterval;

  /** Present exactly when the plan is paid. */
  current_period_start?: utcDateTime;

  /** Present exactly when the plan is paid. */
  current_period_end?: utcDateTime;

  cancel_at_period_end: boolean;
  scheduled_change?: ScheduledPlanChange;
  billing_state: OrgBillingState;

  /** Present exactly when the Org is past due. */
  open_invoice?: OrgInvoice;

  payment_method?: OrgPaymentMethod;

  /** Active users plus unexpired invitations. */
  seats_in_use: int32;

  /** Absent while the Org has no seat cap. */
  seat_limit?: int32;
}

model SetSubscriptionPlanRequest {
  plan_oid: OrgPlan;

  /** Absent for `org-free-tier`; required otherwise. Never null. */
  billing_interval?: OrgBillingInterval;
}

model SetPaymentMethodRequest {
  kind: OrgPaymentMethodKind;
}

model ListInvoicesRequest {
  /** Defaults to 50. */
  limit?: PageSize = 50;

  pagination_key?: PaginationKey;
}

model ListInvoicesResponse {
  /** Newest first. */
  invoices: OrgInvoice[];

  next_pagination_key?: PaginationKey;
}

model PayInvoiceRequest {
  @format("uuid")
  invoice_id: string;
}

@route("/api/orgs")
@tag("Org subscriptions")
interface SubscriptionOperations {
  /**
   * The Org's plan, billing state, payment method, and seat use. Any due
   * period-end transition is computed in memory and nothing is written.
   */
  @route("/my-subscription")
  @get
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_billing"
  )
  mySubscription():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OrgSubscription;
      }
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /**
   * An upgrade (a higher plan, or the same plan going monthly to annual) is
   * charged at once and starts a new period; if the charge cannot be
   * collected nothing changes. A downgrade or cancellation is scheduled for
   * period end and refused while the Org has more users than the target plan
   * allows. Selecting the current plan and interval clears a scheduled change.
   * Refused while an invoice is open.
   */
  @route("/set-subscription-plan")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_billing"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  setSubscriptionPlan(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: SetSubscriptionPlanRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OrgSubscription;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.OrgPlanNotOfferedErrorResponse
    | Vetchium.Problem.OrgBillingPastDueErrorResponse
    | Vetchium.Problem.OrgPaymentMethodRequiredErrorResponse
    | Vetchium.Problem.OrgPaymentDeclinedErrorResponse
    | Vetchium.Problem.OrgUserLimitExceedsTargetErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Save the Org's only payment method, replacing any other. */
  @route("/set-payment-method")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_billing"
  )
  setPaymentMethod(@body request: SetPaymentMethodRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OrgPaymentMethod;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/remove-payment-method")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_billing"
  )
  removePaymentMethod():
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** List invoices newest first. */
  @route("/list-invoices")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_billing"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["created_at", "invoice_id"]
  )
  listInvoices(@body request: ListInvoicesRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListInvoicesResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /**
   * Charge the saved payment method for the open invoice. On success the Org
   * returns to current billing with its period unchanged.
   */
  @route("/pay-invoice")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_billing"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  payInvoice(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: PayInvoiceRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OrgSubscription;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgInvoiceNotOpenErrorResponse
    | Vetchium.Problem.OrgPaymentMethodRequiredErrorResponse
    | Vetchium.Problem.OrgPaymentDeclinedErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
