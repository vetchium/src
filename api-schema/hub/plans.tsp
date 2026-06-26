import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// Hub plan identifiers (Spec 17). Enum, never a bare string.
union HubPlanId {
    Free: "free",
    Pro: "pro",
}

// Capability definition for a hub plan. Pricing is NOT here — prices are
// frontend display-only config (Spec 17).
model HubPlan {
    plan_id: HubPlanId;
    display_order: int32;
    can_upload_profile_picture: boolean;
    can_post_messages: boolean;
    self_upgradeable: boolean;
}

model ListHubPlansRequest {
    // Empty — catalog is read for the authenticated caller
}

model ListHubPlansResponse {
    @doc("Active hub plan catalog, ordered by display_order. Never null.")
    plans: HubPlan[];
}

model SwitchHubPlanRequest {
    @doc("Target plan to switch to")
    plan_id: HubPlanId;
}

model HubPlanResponse {
    @doc("The caller's plan after the switch")
    plan_id: HubPlanId;
    can_upload_profile_picture: boolean;
    can_post_messages: boolean;
}

@route("/hub/list-plans")
interface HubListPlans {
    @tag("HubUsers")
    @post
    @doc("List the active hub plan catalog (bounded — returned un-paginated)")
    listPlans(@body request: ListHubPlansRequest): {
        @statusCode statusCode: 200;
        @body response: ListHubPlansResponse;
    } | {
        @doc("Invalid or expired session token")
        @statusCode statusCode: 401;
    };
}

@route("/hub/switch-plan")
interface HubSwitchPlan {
    @tag("HubUsers")
    @post
    @doc("Switch the authenticated hub user's own plan (display-only; no payment)")
    switchPlan(@body request: SwitchHubPlanRequest): {
        @statusCode statusCode: 200;
        @body response: HubPlanResponse;
    } | {
        @doc("Invalid request parameters or validation errors")
        @statusCode statusCode: 400;
    } | {
        @doc("Invalid or expired session token")
        @statusCode statusCode: 401;
    } | {
        @doc("Target plan does not exist")
        @statusCode statusCode: 404;
    } | {
        @doc("Target plan is retired or not self-upgradeable")
        @statusCode statusCode: 422;
    };
}
