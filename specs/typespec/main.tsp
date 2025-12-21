import "@typespec/http";

import "./hub/hub-users.tsp";
import "./admin/admin-users.tsp";

@service(#{ title: "Vetchium" })
namespace Vetchium;
