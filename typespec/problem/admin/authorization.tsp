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

const SuperadminRequiredError = #{
  type: "vetchium-problem-details/superadmin-required",
  title: "Superadmin required",
  status: 403,
  detail: "The operation requires an authenticated superadmin",
};

alias SuperadminRequiredErrorResponse = Response<
  403,
  typeof SuperadminRequiredError
>;

const PermissionDependencyConflictError = #{
  type: "vetchium-problem-details/permission-dependency-conflict",
  title: "Permission dependency conflict",
  status: 409,
  detail: "The permission cannot be revoked while another assigned permission depends on it",
};

alias PermissionDependencyConflictErrorResponse = Response<
  409,
  typeof PermissionDependencyConflictError
>;

const PermissionNotApplicableError = #{
  type: "vetchium-problem-details/permission-not-applicable",
  title: "Permission not applicable",
  status: 409,
  detail: "Direct permissions are not applicable to a superadmin",
};

alias PermissionNotApplicableErrorResponse = Response<
  409,
  typeof PermissionNotApplicableError
>;

const CannotDemoteCurrentSuperadminError = #{
  type: "vetchium-problem-details/cannot-demote-current-superadmin",
  title: "Cannot demote current superadmin",
  status: 409,
  detail: "A superadmin cannot demote their own account",
};

alias CannotDemoteCurrentSuperadminErrorResponse = Response<
  409,
  typeof CannotDemoteCurrentSuperadminError
>;
