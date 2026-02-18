import "@typespec/http";

import "./global/global.tsp";
import "./hub/hub-users.tsp";
import "./admin/admin-users.tsp";
import "./admin/approved-domains.tsp";
import "./employer/employer-users.tsp";
import "./employer-domains/employer-domains.tsp";

@service(#{ title: "Vetchium" })
namespace Vetchium;
