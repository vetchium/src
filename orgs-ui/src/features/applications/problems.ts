import { ValidationFailedError } from "typespec/problem/details";
import {
  ApplicationNotFoundError,
  ApplicationStateConflictError,
  ApplicationVersionConflictError,
  type InterviewFeedbackAnswersInvalidDetails,
  InterviewFeedbackAnswersInvalidType,
  InterviewFeedbackExistsError,
  type InterviewInterviewersInvalidDetails,
  type InterviewLimitReachedDetails,
  InterviewNotFoundError,
  InterviewStateConflictError,
  OfferLetterConflictError,
  OfferLetterInvalidError,
  OfferLetterTooLargeError,
} from "typespec/problem/orgs/applications";
import { PermissionRequiredError } from "typespec/problem/orgs/authentication";
import { APIError, getProblemType } from "../../api/client";

// The contract declares these two as interfaces (they carry extra members),
// so their type strings are taken from the declarations.
const interviewLimitType: InterviewLimitReachedDetails["type"] =
  "vetchium-problem-details/org-interview-limit-reached";
const interviewersInvalidType: InterviewInterviewersInvalidDetails["type"] =
  "vetchium-problem-details/org-interview-interviewers-invalid";

export type ApplicationProblem =
  | { kind: "version-conflict" }
  | { kind: "state-conflict" }
  | { kind: "not-found" }
  | { kind: "permission-required" }
  | { kind: "interview-not-found" }
  | { kind: "interview-state-conflict" }
  | { kind: "feedback-exists" }
  | { kind: "answers-invalid"; criterionIDs: string[] }
  | { kind: "interview-limit"; limit: number }
  | { kind: "interviewers-invalid"; emails: string[] }
  | { kind: "letter-invalid" }
  | { kind: "letter-too-large" }
  | { kind: "letter-conflict" }
  | { kind: "invalid"; fields: string[] }
  | { kind: "other"; error: unknown };

export function applicationProblem(error: unknown): ApplicationProblem {
  const type = getProblemType(error);
  if (type === ApplicationVersionConflictError.type)
    return { kind: "version-conflict" };
  if (type === ApplicationStateConflictError.type)
    return { kind: "state-conflict" };
  if (type === ApplicationNotFoundError.type) return { kind: "not-found" };
  if (type === PermissionRequiredError.type)
    return { kind: "permission-required" };
  if (type === InterviewNotFoundError.type)
    return { kind: "interview-not-found" };
  if (type === InterviewStateConflictError.type)
    return { kind: "interview-state-conflict" };
  if (type === InterviewFeedbackExistsError.type)
    return { kind: "feedback-exists" };
  if (
    type === InterviewFeedbackAnswersInvalidType &&
    error instanceof APIError
  ) {
    const details = error.problem as
      | InterviewFeedbackAnswersInvalidDetails
      | undefined;
    return {
      kind: "answers-invalid",
      criterionIDs: details?.criterion_ids ?? [],
    };
  }
  if (type === interviewLimitType && error instanceof APIError) {
    const details = error.problem as InterviewLimitReachedDetails | undefined;
    return { kind: "interview-limit", limit: details?.limit ?? 10 };
  }
  if (type === interviewersInvalidType && error instanceof APIError) {
    const details = error.problem as
      | InterviewInterviewersInvalidDetails
      | undefined;
    return {
      kind: "interviewers-invalid",
      emails: details?.email_addresses ?? [],
    };
  }
  if (type === OfferLetterInvalidError.type) return { kind: "letter-invalid" };
  if (type === OfferLetterTooLargeError.type)
    return { kind: "letter-too-large" };
  if (type === OfferLetterConflictError.type)
    return { kind: "letter-conflict" };
  if (type === ValidationFailedError.type && error instanceof APIError) {
    return { kind: "invalid", fields: error.problem?.fields ?? [] };
  }
  return { kind: "other", error };
}
