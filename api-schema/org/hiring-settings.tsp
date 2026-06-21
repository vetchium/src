import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

model OrgHiringSettings {
  cool_off_days: int32;       // 0..365
  allow_unsolicited_endorsements_default: boolean;
}

model UpdateOrgHiringSettingsRequest {
  cool_off_days: int32;
  allow_unsolicited_endorsements_default?: boolean;
}

@route("/org/get-hiring-settings")
@post
op getHiringSettings(): OkResponse<OrgHiringSettings>;

@route("/org/update-hiring-settings")
@post
op updateHiringSettings(...UpdateOrgHiringSettingsRequest):
  OkResponse<{}> | BadRequestResponse;
