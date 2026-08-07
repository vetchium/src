import "@typespec/http";
import "@typespec/openapi3";

import "./common/common.tsp";
import "./admin/auth.tsp";

using TypeSpec.Http;

@service(#{ title: "Vetchium API" })
namespace Vetchium;
