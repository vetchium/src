import "../details.tsp";

namespace Vetchium.Problem;

const AdminUserNotFoundError = #{
  type: "vetchium-problem-details/admin-user-not-found",
  title: "Admin user not found",
  status: 404,
  detail: "The requested admin user does not exist",
};

alias AdminUserNotFoundErrorResponse = Response<
  404,
  typeof AdminUserNotFoundError
>;

const CannotDisableCurrentAdminError = #{
  type: "vetchium-problem-details/cannot-disable-current-admin",
  title: "Cannot disable current admin",
  status: 409,
  detail: "An admin cannot disable their own account",
};

alias CannotDisableCurrentAdminErrorResponse = Response<
  409,
  typeof CannotDisableCurrentAdminError
>;

const AdminUserAlreadyExistsError = #{
  type: "vetchium-problem-details/admin-user-already-exists",
  title: "Admin user already exists",
  status: 409,
  detail: "An admin user already exists for the normalized email address",
};

alias AdminUserAlreadyExistsErrorResponse = Response<
  409,
  typeof AdminUserAlreadyExistsError
>;

const AdminInvitationAlreadyPendingError = #{
  type: "vetchium-problem-details/admin-invitation-already-pending",
  title: "Admin invitation already pending",
  status: 409,
  detail: "A non-expired invitation already exists for the normalized email address",
};

alias AdminInvitationAlreadyPendingErrorResponse = Response<
  409,
  typeof AdminInvitationAlreadyPendingError
>;
