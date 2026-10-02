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
