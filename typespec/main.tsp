import "@typespec/http";
import "@typespec/openapi3";

import "./common/common.tsp";
import "./admin/admin.tsp";
import "./hub/hub.tsp";

import "./regions/regions.tsp";

using TypeSpec.Http;

@service(#{ title: "Vetchium API" })
namespace Vetchium;
