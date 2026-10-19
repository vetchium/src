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
    case "invalid":
      return t(
        problem.fields.includes("stage_id")
          ? "applications.errors.invalidStage"
          : problem.fields.length > 0
            ? "applications.errors.invalidDate"
            : "errors.validationFailed",
      );
    default:
      return problemMessage(t, cause);
  }
}
