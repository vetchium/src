import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestTenant } from "./admin-db.ts";
import type { APIObservation } from "./admin-fixtures.ts";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/**
 * The mesh listeners are deliberately unreachable from this host: the relay
 * answers only inside a tenant's own network namespace, and the peer listener
 * binds that tenant's WireGuard address. Both are therefore driven from inside
 * the tenant's WireGuard node, the same way admin-db.ts reaches a database.
 */
function nodeExec(tenant: TestTenant, script: string, env: string[]): string {
  return execFileSync(
    "docker",
    [
      "compose",
      "-f",
      resolve(repositoryRoot, "docker-compose-ci.json"),
      "exec",
      "-T",
      ...env.flatMap((assignment) => ["-e", assignment]),
      `wg-${tenant}`,
      "sh",
      "-c",
      script,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
}

function secret(name: string): string {
  return execFileSync("cat", [resolve(repositoryRoot, ".dev-secrets", name)], {
    encoding: "utf8",
  }).trim();
}

export interface MeshResponse {
  status: number;
  body: unknown;
}

/**
 * curl writes the body to a file and the status to stdout so a problem
 * response is captured as faithfully as a success; wget would discard the
 * body of every non-2xx status.
 */
function request(
  tenant: TestTenant,
  url: string,
  body: unknown,
  headers: string[],
  extra: string,
  env: string[],
  observations: APIObservation[],
  path: string,
): MeshResponse {
  const headerArguments = headers
    .map((header) => `-H ${JSON.stringify(header)}`)
    .join(" ");
  // Concurrent calls share one node, so each needs its own scratch paths.
  const scratch = `/tmp/mesh-${randomUUID()}`;
  const output = nodeExec(
    tenant,
    `printf '%s' "$MESH_BODY" > ${scratch}.request; ` +
      `status=$(curl -s -o ${scratch}.response -w '%{http_code}' ` +
      `-X POST ${headerArguments} ${extra} ` +
      `--data @${scratch}.request ${JSON.stringify(url)}); ` +
      `printf '%s\\n' "$status"; cat ${scratch}.response; ` +
      `rm -f ${scratch}.request ${scratch}.response`,
    [`MESH_BODY=${JSON.stringify(body)}`, ...env],
  );
  const newline = output.indexOf("\n");
  const status = Number(output.slice(0, newline));
  const raw = output.slice(newline + 1);
  let parsed: unknown;
  try {
    parsed = raw === "" ? undefined : JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  const problem =
    typeof parsed === "object" && parsed !== null && "type" in parsed
      ? (parsed as { type?: unknown }).type
      : undefined;
  observations.push({
    method: "POST",
    path,
    status,
    ...(typeof problem === "string" ? { problemType: problem } : {}),
  });
  return { status, body: parsed };
}

/**
 * Calls a tenant's own mesh relay. `authorization` defaults to the mounted
 * relay credential; pass null to omit it and observe the rejection.
 */
export function meshRelayRequest(
  tenant: TestTenant,
  path: string,
  body: unknown,
  observations: APIObservation[],
  options: { authorization?: string | null; rawBody?: string } = {},
): MeshResponse {
  const credential =
    options.authorization === undefined
      ? secret("mesh_credential")
      : options.authorization;
  const headers = ["Content-Type: application/json"];
  const env: string[] = [];
  if (credential !== null) {
    headers.push("Authorization: Bearer $MESH_CREDENTIAL");
    env.push(`MESH_CREDENTIAL=${credential}`);
  }
  return request(
    tenant,
    `http://localhost:8080${path}`,
    options.rawBody ?? body,
    headers,
    "",
    env,
    observations,
    path,
  );
}

/**
 * Calls another tenant's peer listener across WireGuard, presenting the
 * calling tenant's private-CA client certificate exactly as its mesh-api does.
 */
export function meshPeerRequest(
  from: TestTenant,
  to: TestTenant,
  body: unknown,
  observations: APIObservation[],
  options: { rawBody?: string } = {},
): MeshResponse {
  return request(
    from,
    `https://${to}.mesh.vetchium.com:8443/api/mesh/profile/read`,
    options.rawBody ?? body,
    ["Content-Type: application/json"],
    "--cert /run/secrets/mesh_client_certificate " +
      "--key /run/secrets/mesh_client_key " +
      "--cacert /run/secrets/mesh_ca_certificate",
    [],
    observations,
    "/api/mesh/profile/read",
  );
}
