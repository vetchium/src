import "../details.tsp";

namespace Vetchium.Problem;

const OrgAIUnavailableError = #{
  type: "vetchium-problem-details/org-ai-unavailable",
  title: "AI unavailable",
  status: 404,
  detail: "This region offers no AI models",
};
alias OrgAIUnavailableErrorResponse = Response<
  404,
  typeof OrgAIUnavailableError
>;

const OrgAINotEnabledError = #{
  type: "vetchium-problem-details/org-ai-not-enabled",
  title: "AI not enabled",
  status: 409,
  detail: "AI assistance is off for this organization, or its current AI terms are not accepted",
};
alias OrgAINotEnabledErrorResponse = Response<
  409,
  typeof OrgAINotEnabledError
>;

model OrgAITermsRequiredDetails {
  type: "vetchium-problem-details/org-ai-terms-required";
  title: "AI terms required";
  status: 422;
  detail: "Turning AI assistance on requires accepting the current AI terms";

  /** The version that must be accepted. */
  terms_version: string;

  instance?: string;
}
alias OrgAITermsRequiredErrorResponse = Response<
  422,
  OrgAITermsRequiredDetails
>;

model OrgAIModelNotOfferedDetails {
  type: "vetchium-problem-details/org-ai-model-not-offered";
  title: "AI model not offered";
  status: 422;
  detail: "This region does not offer one or more of the requested models";

  @minItems(1)
  model_oids: string[];

  instance?: string;
}
alias OrgAIModelNotOfferedErrorResponse = Response<
  422,
  OrgAIModelNotOfferedDetails
>;

const OrgAIModelNotAllowedError = #{
  type: "vetchium-problem-details/org-ai-model-not-allowed",
  title: "AI model not allowed",
  status: 422,
  detail: "The organization does not allow that model for this AI operation",
};
alias OrgAIModelNotAllowedErrorResponse = Response<
  422,
  typeof OrgAIModelNotAllowedError
>;

model OrgAICreditsInsufficientDetails {
  type: "vetchium-problem-details/org-ai-credits-insufficient";
  title: "AI credits insufficient";
  status: 409;
  detail: "The organization has too few AI credits for this request";

  /** Credits the request reserves before calling the model. */
  required: int64;

  available: int64;
  instance?: string;
}
alias OrgAICreditsInsufficientErrorResponse = Response<
  409,
  OrgAICreditsInsufficientDetails
>;

const OrgAIRequestInProgressError = #{
  type: "vetchium-problem-details/org-ai-request-in-progress",
  title: "AI request in progress",
  status: 409,
  detail: "A request with this idempotency key is still running",
};
alias OrgAIRequestInProgressErrorResponse = Response<
  409,
  typeof OrgAIRequestInProgressError
>;

const OrgAIModelFailedError = #{
  type: "vetchium-problem-details/org-ai-model-failed",
  title: "AI model failed",
  status: 503,
  detail: "The AI model did not answer. No credits were charged.",
};
alias OrgAIModelFailedErrorResponse = Response<
  503,
  typeof OrgAIModelFailedError
>;

const OrgAIOutputUnusableError = #{
  type: "vetchium-problem-details/org-ai-output-unusable",
  title: "AI output unusable",
  status: 502,
  detail: "The AI model's answer could not be used. No credits were charged.",
};
alias OrgAIOutputUnusableErrorResponse = Response<
  502,
  typeof OrgAIOutputUnusableError
>;

const OrgAIPackNotOfferedError = #{
  type: "vetchium-problem-details/org-ai-pack-not-offered",
  title: "AI credit pack not offered",
  status: 422,
  detail: "This region does not offer that AI credit pack",
};
alias OrgAIPackNotOfferedErrorResponse = Response<
  422,
  typeof OrgAIPackNotOfferedError
>;

const OrgAIUsageNotFoundError = #{
  type: "vetchium-problem-details/org-ai-usage-not-found",
  title: "AI usage not found",
  status: 404,
  detail: "No readable AI usage text has that identifier",
};
alias OrgAIUsageNotFoundErrorResponse = Response<
  404,
  typeof OrgAIUsageNotFoundError
>;
