import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// node_modules is a symlink to orgs-ui's, which lives outside this root.
export default defineConfig({
  plugins: [react()],
  server: { fs: { strict: false } },
});
