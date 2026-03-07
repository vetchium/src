import "@typespec/http";

import "./global/global.tsp";
import "./common/roles.tsp";
import "./hub/hub-users.tsp";
import "./hub/tags.tsp";
import "./admin/admin-users.tsp";
import "./admin/approved-domains.tsp";
import "./admin/tags.tsp";
import "./employer/employer-users.tsp";
import "./employer/cost-centers.tsp";
import "./employer/tags.tsp";
import "./employer-domains/employer-domains.tsp";
import "./agency/agency-users.tsp";
import "./agency/tags.tsp";
import "./agency-domains/agency-domains.tsp";
import "./audit-logs/audit-logs.tsp";

@service(#{ title: "Vetchium" })
namespace Vetchium;
