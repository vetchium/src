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
    const hub: { regions: { mediaOrigin?: unknown }[] } = require(
      `./src/app/regions/${environment}.json`,
    );
    plugins.push(
      securityHeadersPlugin(
        {
          connectSources: apiOrigins,
          imageSources: hub.regions.map((region) => String(region.mediaOrigin)),
          noindexPathPrefixes: ["/u/", "/org/"],
        },
        path.resolve(import.meta.dirname, "dist-nginx"),
      ),
    );
  }
  return { plugins, resolve: { preserveSymlinks: true } };
});
