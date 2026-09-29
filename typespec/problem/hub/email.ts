import type { Details } from "../details.ts";

export const EmailChangeCodeRejectedError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-email-change-code-rejected",
  title: "Email change code rejected",
  status: 400,
  detail: "The email change code could not be accepted",
};

export const EmailAddressUnavailableError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-email-address-unavailable",
  title: "Email address unavailable",
  status: 409,
  detail: "Another Hub account already uses that email address",
};

export const EmailChangeInProgressError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-email-change-in-progress",
  title: "Email change in progress",
  status: 409,
  detail: "Another email change is already in progress for this account",
};

// The global reservation for this change lapsed before it could be applied,
// most likely from a sustained coordinator outage. Retryable: request a new
// code and confirm again.
export const EmailChangeUnavailableError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-email-change-unavailable",
  title: "Email change unavailable",
  status: 503,
  detail: "The email change could not be completed and must be retried",
};
