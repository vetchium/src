import "../details.tsp";

namespace Vetchium.Problem;

const OrgLogoTooLargeError = #{
  type: "vetchium-problem-details/org-logo-too-large",
  title: "Org logo too large",
  status: 413,
  detail: "The logo exceeds the two-mebibyte limit",
};
alias OrgLogoTooLargeErrorResponse = Response<413, typeof OrgLogoTooLargeError>;

const OrgLogoInvalidError = #{
  type: "vetchium-problem-details/org-logo-invalid",
  title: "Invalid Org logo",
  status: 400,
  detail: "The image format or dimensions are not supported",
};
alias OrgLogoInvalidErrorResponse = Response<400, typeof OrgLogoInvalidError>;

const OrgLogoConflictError = #{
  type: "vetchium-problem-details/org-logo-conflict",
  title: "Org logo conflict",
  status: 409,
  detail: "The logo change conflicts with the current state",
};
alias OrgLogoConflictErrorResponse = Response<409, typeof OrgLogoConflictError>;
