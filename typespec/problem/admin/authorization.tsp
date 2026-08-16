import "../details.tsp";

namespace Vetchium.Problem;

const AdminPermissionRequiredError = #{
  type: "vetchium-problem-details/admin-permission-required",
  title: "Admin permission required",
  status: 403,
  detail: "The authenticated admin lacks the required permission",
};

alias AdminPermissionRequiredErrorResponse = Response<
  403,
  typeof AdminPermissionRequiredError
>;
