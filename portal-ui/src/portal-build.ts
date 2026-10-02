// Build-time helpers for each portal's Vite config. Node loads this file
// directly, where portal-ui's own dependencies may not be installed, so it
// imports only Node built-ins and other import-free modules.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type PortalEnvironment,
  parsePortalEnvironment,
} from "./portal-environment.ts";
import {
  nginxPortalInclude,
  type SecurityHeaderPolicy,
  staticHostHeaders,
  staticHostRedirects,
} from "./security-headers.ts";

/**
 * The environment named by `VITE_VETCHIUM_ENVIRONMENT` and its regions' API
 * origins. Throws for an unset or unknown environment, failing the build.
 * The table itself is validated by the portal at startup and by the
 * repository tests; a missing origin still fails `contentSecurityPolicy`.
 */
export function buildRegions(value: unknown): {
  environment: PortalEnvironment;
  apiOrigins: string[];
} {
  const environment = parsePortalEnvironment(value);
  const table = JSON.parse(
    readFileSync(
      path.join(import.meta.dirname, "regions", `${environment}.json`),
      "utf8",
    ),
  ) as { regions: { apiOrigin?: unknown }[] };
  return {
    environment,
    apiOrigins: table.regions.map((region) => String(region.apiOrigin)),
  };
}

interface AssetEmitter {
  emitFile(file: { type: "asset"; fileName: string; source: string }): string;
}

/**
 * A Vite plugin writing the static host's `_headers` and `_redirects` into the
 * bundle and the nginx include for the container image into
 * `nginxDirectory/portal.conf`, outside the published files.
 */
export function securityHeadersPlugin(
  policy: SecurityHeaderPolicy,
  nginxDirectory: string,
) {
  return {
    name: "vetchium-security-headers",
    apply: "build" as const,
    generateBundle(this: AssetEmitter) {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: staticHostHeaders(policy),
      });
      this.emitFile({
        type: "asset",
        fileName: "_redirects",
        source: staticHostRedirects,
      });
    },
    closeBundle() {
      mkdirSync(nginxDirectory, { recursive: true });
      writeFileSync(
        path.join(nginxDirectory, "portal.conf"),
        nginxPortalInclude(policy),
      );
    },
  };
}
