import "@typespec/http";

import "./global/global.tsp";
import "./hub/hub-users.tsp";
import "./admin/admin-users.tsp";
import "./admin/approved-domains.tsp";
import "./org/org-users.tsp";
import "./orgdomains/orgdomains.tsp";

@service(#{ title: "Vetchium" })
namespace Vetchium;
