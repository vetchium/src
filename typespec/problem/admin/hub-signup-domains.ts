import type { Details } from "../details.ts";

export const HubSignupDomainNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-signup-domain-not-found",
  title: "Hub signup domain not found",
  status: 404,
  detail: "The requested Hub signup domain does not exist",
};

export const HubSignupDomainAlreadyExistsError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-signup-domain-already-exists",
  title: "Hub signup domain already exists",
  status: 409,
  detail: "The normalized domain is already in the Hub signup allowlist",
};
