import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parsePortalEnvironment } from "@vetchium/portal-ui/portal-environment";
import {
  nginxPortalInclude,
  type SecurityHeaderPolicy,
  staticHostHeaders,
} from "@vetchium/portal-ui/security-headers";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin, type PluginOption } from "vite";

const require = createRequire(import.meta.url);

interface RegionOrigins {
  regions: { apiOrigin?: string; mediaOrigin?: string }[];
}

/**
 * Writes the static host's `_headers` into the bundle and the nginx include
 * that the container image serves with into `dist-nginx/`, outside the
 * published files.
 */
function securityHeaders(policy: SecurityHeaderPolicy): Plugin {
  return {
    name: "vetchium-security-headers",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: staticHostHeaders(policy),
      });
    },
    closeBundle() {
      const directory = path.resolve(import.meta.dirname, "dist-nginx");
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        path.join(directory, "portal.conf"),
        nginxPortalInclude(policy),
      );
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(
    mode,
    import.meta.dirname,
    "VITE_",
  ).VITE_VETCHIUM_ENVIRONMENT;
  const plugins: PluginOption[] = [react()];
  if (command === "build") {
    // Throws for an unset or unknown environment, failing the build. The
    // tables themselves are validated by the app and the repository tests.
    const name = parsePortalEnvironment(environment);
    const table: RegionOrigins = require(
      `@vetchium/portal-ui/regions/${name}.json`,
    );
    const hub: RegionOrigins = require(`./src/app/regions/${name}.json`);
    plugins.push(
      securityHeaders({
        connectSources: table.regions.map((region) => String(region.apiOrigin)),
        imageSources: hub.regions.map((region) => String(region.mediaOrigin)),
        noindexPathPrefixes: ["/u/", "/org/"],
      }),
    );
  }
  return { plugins, resolve: { preserveSymlinks: true } };
});
