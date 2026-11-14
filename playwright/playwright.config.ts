import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://admin-ui.sgp.localhost";

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  workers: "80%",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    // Portals turn off Ant Design motion for this preference (ui.md).
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    {
      name: "api",
      testMatch: "api/**/*.spec.ts",
    },
    {
      name: "chromium",
      testMatch: "ui/**/*.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        // The CI stack's playwright-browser container runs Chromium away from
        // host network changes (playwright.md); its requests to the portals
        // and APIs on this host's loopback travel back over the connection.
        connectOptions: {
          wsEndpoint:
            process.env.PLAYWRIGHT_BROWSER_ENDPOINT ?? "ws://127.0.0.1:18030/",
          exposeNetwork: "<loopback>",
        },
      },
    },
  ],
});
