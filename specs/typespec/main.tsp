import "@typespec/http";

import "./global/global.tsp";
import "./hub/hub-users.tsp";
import "./admin/admin-users.tsp";
import "./admin/approved-domains.tsp";

@service(#{ title: "Vetchium" })
namespace Vetchium;
