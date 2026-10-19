import "../details.tsp";

namespace Vetchium.Problem;

const OrgApplicationNotFoundError = #{
  type: "vetchium-problem-details/org-application-not-found",
  title: "Org application not found",
  status: 404,
  detail: "No readable application has the requested number",
};
alias OrgApplicationNotFoundErrorResponse = Response<
  404,
  typeof OrgApplicationNotFoundError
>;

const OrgApplicationVersionConflictError = #{
  type: "vetchium-problem-details/org-application-version-conflict",
  title: "Org application version conflict",
  status: 409,
  detail: "The application changed since it was read",
};
alias OrgApplicationVersionConflictErrorResponse = Response<
  409,
  typeof OrgApplicationVersionConflictError
>;

const OrgApplicationStateConflictError = #{
  type: "vetchium-problem-details/org-application-state-conflict",
  title: "Org application state conflict",
  status: 409,
  detail: "The action is not allowed in the application's current state",
};
alias OrgApplicationStateConflictErrorResponse = Response<
  409,
  typeof OrgApplicationStateConflictError
>;
