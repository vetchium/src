import { ValidationFailedError } from "typespec/problem/details";
import {
  ApplicationNotFoundError,
  ApplicationStateConflictError,
  ApplicationVersionConflictError,
} from "typespec/problem/orgs/applications";
import { PermissionRequiredError } from "typespec/problem/orgs/authentication";
import { APIError, getProblemType } from "../../api/client";

export type ApplicationProblem =
  | { kind: "version-conflict" }
  | { kind: "state-conflict" }
  | { kind: "not-found" }
  | { kind: "permission-required" }
  | { kind: "invalid"; fields: string[] }
  | { kind: "other"; error: unknown };

export function applicationProblem(error: unknown): ApplicationProblem {
  const type = getProblemType(error);
  if (type === ApplicationVersionConflictError.type)
    return { kind: "version-conflict" };
  if (type === ApplicationStateConflictError.type)
    return { kind: "state-conflict" };
  if (type === ApplicationNotFoundError.type) return { kind: "not-found" };
  if (type === PermissionRequiredError.type)
    return { kind: "permission-required" };
  if (type === ValidationFailedError.type && error instanceof APIError) {
    return { kind: "invalid", fields: error.problem?.fields ?? [] };
  }
  return { kind: "other", error };
}
