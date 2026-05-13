import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// AssignRoleRequest and RemoveRoleRequest are defined in common.tsp (using email_address field).
// They are imported here so admin and org portals can reference them via this file.
