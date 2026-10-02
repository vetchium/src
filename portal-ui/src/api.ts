import type { Details } from "typespec/problem/details";

export class APIError extends Error {
  readonly status: number;
  readonly problem?: Details;

  constructor(status: number, problem?: Details) {
    super(problem?.detail ?? `HTTP ${status}`);
    this.name = "APIError";
    this.status = status;
    this.problem = problem;
  }
}

export interface PortalAPIClientConfiguration {
  /** Scheme and host of the API, or omitted for the portal's own origin. */
  origin?: () => string;
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
  /** Sends the request to this origin instead of the configured one: a
   * signed-out flow names the region it talks to. Such a request carries no
   * stored session token unless `token` is given, because the token belongs
   * to the region that issued it. */
  origin?: string;
  token?: string | null;
}

/** Bytes the caller already encoded, such as an uploaded image. The caller
 * supplies the matching Content-Type through `headers`. */
function isBinaryBody(body: unknown): body is BodyInit {
  return (
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
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
    if (options.body !== undefined && !isBinaryBody(options.body))
      headers.set("Content-Type", "application/json");
    for (const [name, value] of new Headers(options.headers)) {
      headers.set(name, value);
    }
    const token =
      options.token !== undefined
        ? options.token
        : options.origin !== undefined
          ? null
          : config.readToken();
    if (token !== null) headers.set("Authorization", `Bearer ${token}`);

    const origin = options.origin ?? config.origin?.() ?? "";
    const response = await fetch(`${origin}${config.apiPrefix}${path}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      body:
        options.body === undefined
          ? undefined
          : isBinaryBody(options.body) || typeof options.body === "string"
            ? (options.body as BodyInit)
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
    if (response.status === 204) {
      return undefined as Response;
    }
    if (response.status === 202) {
      const contentType = response.headers.get("Content-Type") ?? "";
      if (!contentType.toLowerCase().startsWith("application/json")) {
        return undefined as Response;
      }
    }
    return (await response.json()) as Response;
  };

  return { isRecentAuthenticationRequired, request };
}
