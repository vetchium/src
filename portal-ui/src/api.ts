import type { Details } from "typespec/problem/details";

export class APIError extends Error {
  constructor(
    readonly status: number,
    readonly problem?: Details,
  ) {
    super(problem?.detail ?? `HTTP ${status}`);
    this.name = "APIError";
  }
}

export interface PortalAPIClientConfiguration {
  apiPrefix: string;
  authenticationProblemType: string;
  recentAuthenticationProblemType: string;
  sessionExpiredEvent: string;
  readToken: () => string | null;
  clearSession: () => void;
}

export interface PortalRequestOptions {
  body?: unknown;
  headers?: HeadersInit;
  method?: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  token?: string | null;
}

async function problemDetails(
  response: Response,
): Promise<Details | undefined> {
  try {
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null) return undefined;
    const candidate = payload as Record<string, unknown>;
    if (
      typeof candidate.type !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.status !== "number"
    ) {
      return undefined;
    }
    return payload as Details;
  } catch {
    return undefined;
  }
}

export function getProblemType(error: unknown): string | undefined {
  return error instanceof APIError ? error.problem?.type : undefined;
}

export function createPortalAPIClient(config: PortalAPIClientConfiguration) {
  const isRecentAuthenticationRequired = (error: unknown): boolean =>
    getProblemType(error) === config.recentAuthenticationProblemType;

  const request = async <Response>(
    path: string,
    options: PortalRequestOptions = {},
  ): Promise<Response> => {
    const headers = new Headers({ Accept: "application/json" });
    if (options.body !== undefined)
      headers.set("Content-Type", "application/json");
    for (const [name, value] of new Headers(options.headers)) {
      headers.set(name, value);
    }
    const token =
      options.token === undefined ? config.readToken() : options.token;
    if (token !== null) headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(`${config.apiPrefix}${path}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      body:
        options.body === undefined
          ? undefined
          : typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body),
    });
    if (!response.ok) {
      const error = new APIError(
        response.status,
        await problemDetails(response),
      );
      const type = getProblemType(error);
      const describesSession =
        type === undefined || type === config.authenticationProblemType;
      if (
        response.status === 401 &&
        token !== null &&
        config.readToken() === token &&
        !isRecentAuthenticationRequired(error) &&
        describesSession
      ) {
        config.clearSession();
        window.dispatchEvent(new Event(config.sessionExpiredEvent));
      }
      throw error;
    }
    if (response.status === 202 || response.status === 204) {
      return undefined as Response;
    }
    return (await response.json()) as Response;
  };

  return { isRecentAuthenticationRequired, request };
}
