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

const OrgInterviewNotFoundError = #{
  type: "vetchium-problem-details/org-interview-not-found",
  title: "Org interview not found",
  status: 404,
  detail: "The application has no interview with the requested number",
};
alias OrgInterviewNotFoundErrorResponse = Response<
  404,
  typeof OrgInterviewNotFoundError
>;

const OrgInterviewStateConflictError = #{
  type: "vetchium-problem-details/org-interview-state-conflict",
  title: "Org interview state conflict",
  status: 409,
  detail: "The action is not allowed in the interview's current state or time",
};
alias OrgInterviewStateConflictErrorResponse = Response<
  409,
  typeof OrgInterviewStateConflictError
>;

const OrgInterviewFeedbackExistsError = #{
  type: "vetchium-problem-details/org-interview-feedback-exists",
  title: "Org interview feedback exists",
  status: 409,
  detail: "The caller already submitted feedback on the interview",
};
alias OrgInterviewFeedbackExistsErrorResponse = Response<
  409,
  typeof OrgInterviewFeedbackExistsError
>;

model OrgInterviewLimitReachedDetails {
  type: "vetchium-problem-details/org-interview-limit-reached";
  title: "Org interview limit reached";
  status: 409;
  detail: "The candidacy already has the most interviews it may hold at this stage";
  limit: int32;
  instance?: string;
}
alias OrgInterviewLimitReachedErrorResponse = Response<
  409,
  OrgInterviewLimitReachedDetails
>;

model OrgInterviewInterviewersInvalidDetails {
  type: "vetchium-problem-details/org-interview-interviewers-invalid";
  title: "Org interview interviewers invalid";
  status: 422;
  detail: "A named interviewer is not an active user of the Org";

  @minItems(1)
  email_addresses: string[];

  instance?: string;
}
alias OrgInterviewInterviewersInvalidErrorResponse = Response<
  422,
  OrgInterviewInterviewersInvalidDetails
>;
