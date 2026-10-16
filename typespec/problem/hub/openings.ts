import type { Details } from "../details.ts";

export const OrgNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-org-not-found",
  title: "Org not found",
  status: 404,
  detail: "The requested Org was not found",
};

export const OpeningNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-opening-not-found",
  title: "Opening not found",
  status: 404,
  detail: "The requested Opening was not found",
};

export const OrgUnavailableError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-org-unavailable",
  title: "Org unavailable",
  status: 503,
  detail: "The requested Org is temporarily unavailable",
};
