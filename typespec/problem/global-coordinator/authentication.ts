import type { Details } from "../details.ts";

export const AuthenticationRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/global-coordinator-authentication-required",
  title: "Global coordinator authentication required",
  status: 401,
  detail: "A valid global coordinator bearer credential is required",
};
