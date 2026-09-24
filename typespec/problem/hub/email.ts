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
