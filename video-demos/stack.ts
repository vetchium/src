// Access to the `make dev` stack for off-camera steps: the sgp region's API,
// Mailpit, and its tenant database.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LoginAuthenticatedResponse } from "typespec/orgs/auth/login";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..");

export const API = "http://sgp.api.vetchium.localhost";
export const ADMIN = "http://admin-ui.sgp.localhost";
export const ORGS = "http://orgs.vetchium.localhost";
export const HUB = "http://vetchium.localhost";
export const MAILPIT =
  process.env.DEV_SEED_MAILPIT_URL ?? "http://127.0.0.1:18025";

/** The development password dev-seed gives every account (README.md). */
export const PASSWORD = "DevPassword123$";
export const SGP_ADMIN = "admin@sgp.test";

const idempotencyKey = () => `demo-${randomBytes(24).toString("base64url")}`;

/** POSTs a JSON body and returns the parsed answer; any other status throws. */
export async function post<Response = unknown, Request = unknown>(
  origin: string,
  path: string,
  body: Request,
  token?: string,
): Promise<Response> {
  return send(origin, path, JSON.stringify(body), "application/json", token);
}

export async function upload<Response>(
  path: string,
  bytes: Buffer,
  token: string,
): Promise<Response> {
  return send(API, path, new Uint8Array(bytes), "application/pdf", token);
}

async function send<Response>(
  origin: string,
  path: string,
  body: BodyInit,
  contentType: string,
  token: string | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Idempotency-Key": idempotencyKey(),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers,
    body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text}`);
  return (text === "" ? {} : JSON.parse(text)) as Response;
}

export async function orgLogin(domain: string, email: string): Promise<string> {
  const session = await post<LoginAuthenticatedResponse>(
    API,
    "/api/orgs/login",
    {
      domain,
      email_address: email,
      password: PASSWORD,
    },
  );
  return session.session_token;
}

/** The newest email to `to` whose subject contains `subject`, as text. */
export async function mail(to: string, subject: string): Promise<string> {
  const query = encodeURIComponent(`to:${to} subject:"${subject}"`);
  return until(`a "${subject}" email to ${to}`, async () => {
    const response = await fetch(`${MAILPIT}/view/latest.txt?query=${query}`);
    const text = response.ok ? await response.text() : "";
    return text === "" ? undefined : text;
  });
}

/** The 64-hex token of an emailed portal link such as `/complete-signup`. */
export function linkToken(text: string, path: string): string {
  const token = text.match(
    new RegExp(`${path}\\?region=sgp&token=([0-9a-f]{64})`),
  )?.[1];
  if (!token) throw new Error(`no ${path} link in the email`);
  return token;
}

/** Runs one statement against the sgp tenant database, returning its text. */
export function sql(query: string): string {
  return execFileSync(
    "docker",
    [
      "compose",
      "-f",
      join(REPO, "docker-compose.json"),
      "exec",
      "-T",
      "db-sgp",
      "env",
      "PGPASSWORD=pgpassword",
      "psql",
      "-U",
      "pguser",
      "-d",
      "tenant_db",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atqc",
      query,
    ],
    { cwd: REPO, encoding: "utf8" },
  ).trim();
}

export const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Polls `check` until it returns a value. */
export async function until<T>(
  what: string,
  check: () => Promise<T | undefined>,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}
