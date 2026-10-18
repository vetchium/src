import type { Details } from "../details.ts";

export const ApplicationNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-application-not-found",
  title: "Org application not found",
  status: 404,
  detail: "No readable application has the requested number",
};
