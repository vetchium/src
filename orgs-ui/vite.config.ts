import path from "node:path";
import {
  buildRegions,
  securityHeadersPlugin,
} from "@vetchium/portal-ui/portal-build";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type PluginOption } from "vite";

export default defineConfig(({ command, mode }) => {
  const plugins: PluginOption[] = [react()];
  if (command === "build") {
    const { apiOrigins } = buildRegions(
      loadEnv(mode, import.meta.dirname, "VITE_").VITE_VETCHIUM_ENVIRONMENT,
    );
    plugins.push(
      securityHeadersPlugin(
        {
          connectSources: apiOrigins,
          imageSources: [],
          noindexPathPrefixes: [],
        },
        path.resolve(import.meta.dirname, "dist-nginx"),
      ),
    );
  }
  return { plugins, resolve: { preserveSymlinks: true } };
});
