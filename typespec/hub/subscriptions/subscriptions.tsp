import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/subscriptions.tsp";
import "./plans.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub;

model ScheduledPlanChange {
  plan_oid: HubPlanOID;

  /** Absent when the scheduled plan is `hub-free-tier`. */
  billing_interval?: BillingInterval;
}

model HubSubscription {
  plan_oid: HubPlanOID;

  /** Present exactly when the plan is paid. */
  billing_interval?: BillingInterval;

  /** Present exactly when the plan is paid. */
  current_period_start?: utcDateTime;

  /** Present exactly when the plan is paid. */
  current_period_end?: utcDateTime;

  cancel_at_period_end: boolean;
  scheduled_change?: ScheduledPlanChange;
}

model SetSubscriptionPlanRequest {
  plan_oid: HubPlan;

  /** Absent for `hub-free-tier`; required otherwise. Never null. */
  billing_interval?: BillingInterval;
}

@route("/api/hub")
@tag("Hub subscriptions")
interface SubscriptionOperations {
  @route("/my-subscription")
  @get
  @useAuth(BearerAuth)
  mySubscription():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: HubSubscription;
      }
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/set-subscription-plan")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @useAuth(BearerAuth)
  setSubscriptionPlan(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: SetSubscriptionPlanRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: HubSubscription;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.HubPlanNotOfferedErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
