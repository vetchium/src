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

const OrgOfferLetterTooLargeError = #{
  type: "vetchium-problem-details/org-offer-letter-too-large",
  title: "Org offer letter too large",
  status: 413,
  detail: "The offer letter exceeds the five-mebibyte limit",
};
alias OrgOfferLetterTooLargeErrorResponse = Response<
  413,
  typeof OrgOfferLetterTooLargeError
>;

const OrgOfferLetterInvalidError = #{
  type: "vetchium-problem-details/org-offer-letter-invalid",
  title: "Invalid Org offer letter",
  status: 400,
  detail: "The offer letter is not a PDF",
};
alias OrgOfferLetterInvalidErrorResponse = Response<
  400,
  typeof OrgOfferLetterInvalidError
>;

/** The staged letter of this upload was superseded by a newer upload or
 * expired before it was stored. Upload again with a new idempotency key. */
const OrgOfferLetterConflictError = #{
  type: "vetchium-problem-details/org-offer-letter-conflict",
  title: "Org offer letter conflict",
  status: 409,
  detail: "The upload was superseded or expired before it completed",
};
alias OrgOfferLetterConflictErrorResponse = Response<
  409,
  typeof OrgOfferLetterConflictError
>;
