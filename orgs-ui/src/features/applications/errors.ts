import type { TFunction } from "i18next";
import { problemMessage } from "../../components/common/APIErrorAlert";
import { applicationProblem } from "./problems";

/** The message for a refused application action, naming the specific rule. */
export function applicationErrorMessage(t: TFunction, cause: unknown): string {
  const problem = applicationProblem(cause);
  switch (problem.kind) {
    case "version-conflict":
      return t("applications.errors.versionConflict");
    case "state-conflict":
      return t("applications.errors.stateConflict");
    case "not-found":
      return t("applications.errors.notFound");
    case "permission-required":
      return t("applications.errors.permissionRequired");
    case "interview-not-found":
      return t("applications.errors.interviewNotFound");
    case "interview-state-conflict":
      return t("applications.errors.interviewStateConflict");
    case "feedback-exists":
      return t("applications.errors.feedbackExists");
    case "answers-invalid":
      return t("applications.errors.answersInvalid");
    case "interview-limit":
      return t("applications.errors.interviewLimit", { count: problem.limit });
    case "interviewers-invalid":
      return t("applications.errors.interviewersInvalid", {
        emails: problem.emails.join(", "),
      });
    case "letter-invalid":
      return t("applications.errors.letterInvalid");
    case "letter-too-large":
      return t("applications.errors.letterTooLarge");
    case "letter-conflict":
      return t("applications.errors.letterConflict");
    case "invalid":
      return t(
        problem.fields.includes("stage_id")
          ? "applications.errors.invalidStage"
          : problem.fields.includes("start_time")
            ? "applications.errors.invalidStart"
            : problem.fields.includes("proposed_joining_date")
              ? "applications.errors.invalidProposedDate"
              : problem.fields.length > 0
                ? "applications.errors.invalidDate"
                : "errors.validationFailed",
      );
    default:
      return problemMessage(t, cause);
  }
}
