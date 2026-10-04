import { createRequire } from "node:module";
import path from "node:path";
import {
  buildRegions,
  securityHeadersPlugin,
} from "@vetchium/portal-ui/portal-build";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type PluginOption } from "vite";

const require = createRequire(import.meta.url);

export default defineConfig(({ command, mode }) => {
  const plugins: PluginOption[] = [react()];
  if (command === "build") {
    const { environment, apiOrigins } = buildRegions(
      loadEnv(mode, import.meta.dirname, "VITE_").VITE_VETCHIUM_ENVIRONMENT,
    );
    const org: {
      dnsOverHTTPS?: unknown;
      regions: { mediaOrigin?: unknown }[];
    } = require(`./src/app/regions/${environment}.json`);
    plugins.push(
      securityHeadersPlugin(
        {
          // The signup completion page checks its TXT record through the
          // resolver before the region's API checks it again.
          connectSources: [
            ...apiOrigins,
            new URL(String(org.dnsOverHTTPS)).origin,
          ],
          imageSources: org.regions.map((region) => String(region.mediaOrigin)),
          noindexPathPrefixes: [],
          strictTransportSecurity: environment === "production",
        },
        path.resolve(import.meta.dirname, "dist-nginx"),
      ),
    );
  }
  return { plugins, resolve: { preserveSymlinks: true } };
});
