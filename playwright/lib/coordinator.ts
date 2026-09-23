import { resolve } from "node:path";
import type { APIRequest, APIRequestContext } from "@playwright/test";
import type { TestTenant } from "./admin-db.ts";
import {
  type APIObservation,
  trackedRequestContext,
} from "./admin-fixtures.ts";

/** The global coordinator's mesh-facing origin, reachable over tenant mTLS. */
export const coordinator =
  process.env.GLOBAL_COORDINATOR_TEST_URL ??
  `https://127.0.0.1:${process.env.GLOBAL_COORDINATOR_PORT ?? "18080"}`;

/**
 * "health" is the container healthcheck's client-auth certificate (a system
 * health workload, not a tenant) and "server" is the coordinator's own TLS
 * server certificate presented as a (wrong-purpose) client certificate; both
 * exist to exercise authentication rejection. Any tenant ID authenticates as
 * that tenant's mesh client.
 */
export type CoordinatorCertificate = "health" | "server" | TestTenant;

/** Build a request context presenting the given certificate to the coordinator. */
export async function coordinatorContext(
  apiRequest: APIRequest,
  certificate: CoordinatorCertificate,
  observations: APIObservation[],
): Promise<APIRequestContext> {
  const prefix =
    certificate === "health"
      ? "global_coordinator_health"
      : certificate === "server"
        ? "global_coordinator_tls"
        : `mesh_client_${certificate}`;
  const context = await apiRequest.newContext({
    ignoreHTTPSErrors: true,
    clientCertificates: [
      {
        origin: coordinator,
        certPath: resolve(`../.dev-secrets/${prefix}_certificate`),
        keyPath: resolve(`../.dev-secrets/${prefix}_key`),
      },
    ],
  });
  return trackedRequestContext(context, observations);
}
