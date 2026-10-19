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
