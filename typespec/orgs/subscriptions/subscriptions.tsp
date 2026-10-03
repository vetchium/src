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
import "./plans.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs;

model OrgSubscription {
  plan_oid: OrgPlanOID;

  /** Absent on Free. */
  billing_interval?: OrgBillingInterval;

  seats_in_use: int32;

  /** Absent when uncapped. */
  seat_limit?: int32;
}

model SetSubscriptionPlanRequest {
  plan_oid: OrgPlan;

  /** Absent for Free; required otherwise. Never null. */
  billing_interval?: OrgBillingInterval;
}

@route("/api/orgs")
@tag("Org subscriptions")
interface SubscriptionOperations {
  /** Read the current plan and seat use. */
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

  /** Apply a free, immediate plan and interval change. Refuse excess seats. */
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
    | Vetchium.Problem.OrgUserLimitExceedsTargetErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
