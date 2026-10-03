import type { Details } from "../details.ts";

export const LogoTooLargeError: Readonly<Details> = {
  type: "vetchium-problem-details/org-logo-too-large",
  title: "Org logo too large",
  status: 413,
  detail: "The logo exceeds the two-mebibyte limit",
};

export const LogoInvalidError: Readonly<Details> = {
  type: "vetchium-problem-details/org-logo-invalid",
  title: "Invalid Org logo",
  status: 400,
  detail: "The image format or dimensions are not supported",
};

export const LogoConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/org-logo-conflict",
  title: "Org logo conflict",
  status: 409,
  detail: "The logo change conflicts with the current state",
};
