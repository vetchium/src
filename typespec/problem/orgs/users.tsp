import "../details.tsp";

namespace Vetchium.Problem;

model OrgUserLimitReachedDetails {
  type: "vetchium-problem-details/org-user-limit-reached";
  title: "Org user limit reached";
  status: 409;
  detail: "The Org has no free seat under its plan";

  /** The seat cap in force for the Org. */
  limit: int32;

  instance?: string;
}
alias OrgUserLimitReachedErrorResponse = Response<
  409,
  OrgUserLimitReachedDetails
>;

const OrgInvitationInvalidError = #{
  type: "vetchium-problem-details/org-invitation-invalid",
  title: "Invalid Org invitation",
  status: 401,
  detail: "Invitation token is invalid, expired, consumed, or cancelled",
};
alias OrgInvitationInvalidErrorResponse = AuthenticationResponse<
  "VetchiumInvitation realm=\"orgs\"",
  typeof OrgInvitationInvalidError
>;

const OrgInvitationNotFoundError = #{
  type: "vetchium-problem-details/org-invitation-not-found",
  title: "Org invitation not found",
  status: 404,
  detail: "No pending invitation exists for an address in the request",
};
alias OrgInvitationNotFoundErrorResponse = Response<
  404,
  typeof OrgInvitationNotFoundError
>;

const OrgUserAlreadyExistsError = #{
  type: "vetchium-problem-details/org-user-already-exists",
  title: "Org user already exists",
  status: 409,
  detail: "An Org user already exists for the invited address",
};
alias OrgUserAlreadyExistsErrorResponse = Response<
  409,
  typeof OrgUserAlreadyExistsError
>;

model OrgUserNotFoundDetails {
  type: "vetchium-problem-details/org-user-not-found";
  title: "Org user not found";
  status: 404;
  detail: "No Org user exists for an address in the request";

  /** The first address in the request that has no user. */
  email_address: string;

  instance?: string;
}
alias OrgUserNotFoundErrorResponse = Response<404, OrgUserNotFoundDetails>;

const OrgSelfChangeForbiddenError = #{
  type: "vetchium-problem-details/org-self-change-forbidden",
  title: "Org user cannot change itself",
  status: 409,
  detail: "An Org user cannot disable itself or change its own permissions",
};
alias OrgSelfChangeForbiddenErrorResponse = Response<
  409,
  typeof OrgSelfChangeForbiddenError
>;

const OrgLastSuperadminError = #{
  type: "vetchium-problem-details/org-last-superadmin",
  title: "Last Org superadmin",
  status: 409,
  detail: "At least one active Org user must keep org:superadmin",
};
alias OrgLastSuperadminErrorResponse = Response<
  409,
  typeof OrgLastSuperadminError
>;

model OrgSuperadminRequiredDetails {
  type: "vetchium-problem-details/org-superadmin-required";
  title: "Org superadmin required";
  status: 403;
  detail: "Only an Org superadmin may change this user or these permissions";

  /** The first address in the request whose change needs a superadmin. */
  email_address: string;

  instance?: string;
}
alias OrgSuperadminRequiredErrorResponse = Response<
  403,
  OrgSuperadminRequiredDetails
>;
