import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

model HubApplyPreferences {
  notify_connections_on_apply:     boolean;
  allow_unsolicited_endorsements:  boolean;
}

model SetNotifyConnectionsOnApplyRequest {
  notify_connections_on_apply: boolean;
}

model SetAllowUnsolicitedEndorsementsRequest {
  allow_unsolicited_endorsements: boolean;
}

@route("/hub/get-apply-preferences")
@post
op getApplyPreferences(): OkResponse<HubApplyPreferences>;

@route("/hub/set-notify-connections-on-apply")
@post
op setNotifyConnectionsOnApply(...SetNotifyConnectionsOnApplyRequest):
  OkResponse<{}>;

@route("/hub/set-allow-unsolicited-endorsements")
@post
op setAllowUnsolicitedEndorsements(...SetAllowUnsolicitedEndorsementsRequest):
  OkResponse<{}>;
