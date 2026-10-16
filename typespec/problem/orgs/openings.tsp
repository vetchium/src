import "../details.tsp";

namespace Vetchium.Problem;

const OrgOpeningNotFoundError = #{
  type: "vetchium-problem-details/org-opening-not-found",
  title: "Org Opening not found",
  status: 404,
  detail: "No readable Opening has the requested number",
};
alias OrgOpeningNotFoundErrorResponse = Response<
  404,
  typeof OrgOpeningNotFoundError
>;

const OrgOpeningVersionConflictError = #{
  type: "vetchium-problem-details/org-opening-version-conflict",
  title: "Org Opening version conflict",
  status: 409,
  detail: "The Opening changed since it was read",
};
alias OrgOpeningVersionConflictErrorResponse = Response<
  409,
  typeof OrgOpeningVersionConflictError
>;

const OrgOpeningRequestPendingError = #{
  type: "vetchium-problem-details/org-opening-request-pending",
  title: "Org Opening request pending",
  status: 409,
  detail: "Another request is pending for this Opening",
};
alias OrgOpeningRequestPendingErrorResponse = Response<
  409,
  typeof OrgOpeningRequestPendingError
>;

const OrgOpeningStateConflictError = #{
  type: "vetchium-problem-details/org-opening-state-conflict",
  title: "Org Opening state conflict",
  status: 409,
  detail: "The action is not allowed in the Opening's current state",
};
alias OrgOpeningStateConflictErrorResponse = Response<
  409,
  typeof OrgOpeningStateConflictError
>;

model OrgOpeningIncompleteDetails {
  type: "vetchium-problem-details/org-opening-incomplete";
  title: "Org Opening incomplete";
  status: 422;
  detail: "The Opening is incomplete for publication";

  @minItems(1)
  fields: string[];

  instance?: string;
}
alias OrgOpeningIncompleteErrorResponse = Response<
  422,
  OrgOpeningIncompleteDetails
>;

model OrgOpeningHiringTeamInvalidDetails {
  type: "vetchium-problem-details/org-opening-hiring-team-invalid";
  title: "Org Opening hiring team invalid";
  status: 422;
  detail: "A named hiring-team user is unavailable";

  @minItems(1)
  email_addresses: string[];

  instance?: string;
}
alias OrgOpeningHiringTeamInvalidErrorResponse = Response<
  422,
  OrgOpeningHiringTeamInvalidDetails
>;

model OrgOpeningsQuotaExceededDetails {
  type: "vetchium-problem-details/org-openings-quota-exceeded";
  title: "Org Openings quota exceeded";
  status: 409;
  detail: "The Org has no free Opening slot under its plan";
  quota: int32;
  count: int32;
  instance?: string;
}
alias OrgOpeningsQuotaExceededErrorResponse = Response<
  409,
  OrgOpeningsQuotaExceededDetails
>;
