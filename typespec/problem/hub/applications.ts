import type { ApplicationQuestionID } from "../../common/openings.ts";
import type { Details } from "../details.ts";

export const ApplicationExistsError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-application-exists",
  title: "Application exists",
  status: 409,
  detail: "The applicant already applied to this Opening",
};

export const OpeningNotAcceptingError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-opening-not-accepting",
  title: "Opening not accepting applications",
  status: 409,
  detail: "The Opening is not accepting applications",
};

export const ApplicationNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-application-not-found",
  title: "Application not found",
  status: 404,
  detail: "The requested application was not found",
};

export const ApplicationStateConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-application-state-conflict",
  title: "Application state conflict",
  status: 409,
  detail: "The application's current state does not allow this action",
};

export const ReferralAgencyNotEligibleError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-referral-agency-not-eligible",
  title: "Referral agency not eligible",
  status: 422,
  detail:
    "The named domain is not the primary domain of an agency assigned to the Opening",
};

export const ApplicationAnswersInvalidType =
  "vetchium-problem-details/hub-application-answers-invalid" as const;

export interface ApplicationAnswersInvalidDetails extends Details {
  type: typeof ApplicationAnswersInvalidType;
  question_ids: ApplicationQuestionID[];
}
