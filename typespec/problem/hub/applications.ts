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
