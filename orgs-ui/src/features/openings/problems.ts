import { APIError, getProblemType } from "../../api/client";

export type OpeningProblem =
  | { kind: "version-conflict" }
  | { kind: "quota-exceeded"; quota: number; count: number }
  | { kind: "hiring-team-invalid"; emailAddresses: string[] }
  | { kind: "other"; error: unknown };

export function openingProblem(error: unknown): OpeningProblem {
  const type = getProblemType(error);
  const problem = error instanceof APIError ? error.problem : undefined;
  if (type === "vetchium-problem-details/org-opening-version-conflict") {
    return { kind: "version-conflict" };
  }
  if (type === "vetchium-problem-details/org-openings-quota-exceeded") {
    const quota = Reflect.get(problem ?? {}, "quota");
    const count = Reflect.get(problem ?? {}, "count");
    if (typeof quota === "number" && typeof count === "number") {
      return { kind: "quota-exceeded", quota, count };
    }
  }
  if (type === "vetchium-problem-details/org-opening-hiring-team-invalid") {
    const addresses = Reflect.get(problem ?? {}, "email_addresses");
    if (
      Array.isArray(addresses) &&
      addresses.every((item) => typeof item === "string")
    ) {
      return { kind: "hiring-team-invalid", emailAddresses: addresses };
    }
  }
  return { kind: "other", error };
}
