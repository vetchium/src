import "../../common/openings.tsp";
import "../details.tsp";

namespace Vetchium.Problem;

const HubApplicationExistsError = #{
  type: "vetchium-problem-details/hub-application-exists",
  title: "Application exists",
  status: 409,
  detail: "The applicant already applied to this Opening",
};
alias HubApplicationExistsErrorResponse = Response<
  409,
  typeof HubApplicationExistsError
>;

const HubOpeningNotAcceptingError = #{
  type: "vetchium-problem-details/hub-opening-not-accepting",
  title: "Opening not accepting applications",
  status: 409,
  detail: "The Opening is not accepting applications",
};
alias HubOpeningNotAcceptingErrorResponse = Response<
  409,
  typeof HubOpeningNotAcceptingError
>;

/** An unknown application, or one that is not the caller's. */
const HubApplicationNotFoundError = #{
  type: "vetchium-problem-details/hub-application-not-found",
  title: "Application not found",
  status: 404,
  detail: "The requested application was not found",
};
alias HubApplicationNotFoundErrorResponse = Response<
  404,
  typeof HubApplicationNotFoundError
>;

/** The application's current state does not allow the applicant's action. */
const HubApplicationStateConflictError = #{
  type: "vetchium-problem-details/hub-application-state-conflict",
  title: "Application state conflict",
  status: 409,
  detail: "The application's current state does not allow this action",
};
alias HubApplicationStateConflictErrorResponse = Response<
  409,
  typeof HubApplicationStateConflictError
>;

/**
 * Answers that do not fit the Opening's live questions: a required question
 * unanswered, an unknown or repeated question id, or a value outside its
 * question's type, bounds, or options (HP-QST-004).
 */
model HubApplicationAnswersInvalidDetails {
  type: "vetchium-problem-details/hub-application-answers-invalid";
  title: "Application answers invalid";
  status: 422;
  detail: "The answers do not fit the Opening's questions";

  /** The questions whose answers to fix, in question order. */
  @minItems(1)
  @maxItems(20)
  question_ids: Vetchium.ApplicationQuestionID[];

  instance?: string;
}
alias HubApplicationAnswersInvalidErrorResponse = Response<
  422,
  HubApplicationAnswersInvalidDetails
>;

/** The named domain is not the primary domain of an agency assigned to the Opening. */
const HubReferralAgencyNotEligibleError = #{
  type: "vetchium-problem-details/hub-referral-agency-not-eligible",
  title: "Referral agency not eligible",
  status: 422,
  detail: "The named domain is not the primary domain of an agency assigned to the Opening",
};
alias HubReferralAgencyNotEligibleErrorResponse = Response<
  422,
  typeof HubReferralAgencyNotEligibleError
>;
