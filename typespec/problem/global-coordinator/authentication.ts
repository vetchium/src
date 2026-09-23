import type { Details } from "../details.ts";

export const AuthenticationRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/global-coordinator-authentication-required",
  title: "Global coordinator authentication required",
  status: 401,
  detail: "A private-CA verified tenant mesh client certificate is required",
};

export const MeshRelayAuthenticationRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/mesh-relay-authentication-required",
  title: "Mesh relay authentication required",
  status: 401,
  detail: "A valid tenant-local mesh relay credential is required",
};
