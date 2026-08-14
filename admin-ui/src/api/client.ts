import type { ValidateFunction } from "ajv";

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, payload: unknown) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export async function requestJson<Response>(
  path: string,
  init: RequestInit,
  validate: ValidateFunction<Response>,
): Promise<Response> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...init.headers,
    },
  });

  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, payload);
  }

  if (!validate(payload)) {
    throw new Error("The API response did not match its JSON schema");
  }

  return payload;
}
