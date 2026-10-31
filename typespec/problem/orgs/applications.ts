import type { FeedbackCriterionID } from "../../orgs/hiring/pipelines.ts";
import type { Details } from "../details.ts";

export const ApplicationNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-application-not-found",
  title: "Org application not found",
  status: 404,
  detail: "No readable application has the requested number",
};

export const ApplicationVersionConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/org-application-version-conflict",
  title: "Org application version conflict",
  status: 409,
  detail: "The application changed since it was read",
};

export const ApplicationStateConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/org-application-state-conflict",
  title: "Org application state conflict",
  status: 409,
  detail: "The action is not allowed in the application's current state",
};

export const OfferLetterTooLargeError: Readonly<Details> = {
  type: "vetchium-problem-details/org-offer-letter-too-large",
  title: "Org offer letter too large",
  status: 413,
  detail: "The offer letter exceeds the five-mebibyte limit",
};

export const OfferLetterInvalidError: Readonly<Details> = {
  type: "vetchium-problem-details/org-offer-letter-invalid",
  title: "Invalid Org offer letter",
  status: 400,
  detail: "The offer letter is not a PDF",
};

export const OfferLetterConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/org-offer-letter-conflict",
  title: "Org offer letter conflict",
  status: 409,
  detail: "The upload was superseded or expired before it completed",
};

export const InterviewNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-interview-not-found",
  title: "Org interview not found",
  status: 404,
  detail: "The application has no interview with the requested number",
};

export const InterviewStateConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/org-interview-state-conflict",
  title: "Org interview state conflict",
  status: 409,
  detail: "The action is not allowed in the interview's current state or time",
};

export const InterviewFeedbackExistsError: Readonly<Details> = {
  type: "vetchium-problem-details/org-interview-feedback-exists",
  title: "Org interview feedback exists",
  status: 409,
  detail: "The caller already submitted feedback on the interview",
};

export const InterviewFeedbackAnswersInvalidType =
  "vetchium-problem-details/org-interview-feedback-answers-invalid" as const;

/** The criteria answers do not fit the stage's form (HP-FRM-003). */
export interface InterviewFeedbackAnswersInvalidDetails extends Details {
  type: typeof InterviewFeedbackAnswersInvalidType;
  criterion_ids: FeedbackCriterionID[];
}

export interface InterviewLimitReachedDetails extends Details {
  type: "vetchium-problem-details/org-interview-limit-reached";
  limit: number;
}

export interface InterviewInterviewersInvalidDetails extends Details {
  type: "vetchium-problem-details/org-interview-interviewers-invalid";
  email_addresses: string[];
}
