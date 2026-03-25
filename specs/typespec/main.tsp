import "@typespec/http";

import "./global/global.tsp";
import "./common/roles.tsp";
import "./hub/hub-users.tsp";
import "./hub/tags.tsp";
import "./admin/admin-users.tsp";
import "./admin/approved-domains.tsp";
import "./admin/tags.tsp";
import "./org/org-users.tsp";
import "./org/cost-centers.tsp";
import "./org/suborgs.tsp";
import "./org/tags.tsp";
import "./org-domains/org-domains.tsp";
import "./audit-logs/audit-logs.tsp";

@service(#{ title: "Vetchium" })
namespace Vetchium;
