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
