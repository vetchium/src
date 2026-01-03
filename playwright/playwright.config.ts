import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Vetchium API and UI tests.
 *
 * Environment requirements:
 * - All services must be running via `docker compose up` from src/
 * - API Server: http://localhost:8080 (nginx load balancer)
 * - Mailpit API: http://localhost:8025
 * - Global DB: postgresql://vetchium:vetchium_dev@localhost:5432/vetchium_global
 */
export default defineConfig({
	testDir: "./tests",

	// Run all tests in parallel - each test is fully independent
	fullyParallel: true,

	// Fail the build on CI if you accidentally left test.only in the source code
	forbidOnly: !!process.env.CI,

	// Retry on CI only
	retries: process.env.CI ? 2 : 0,

	// Use multiple workers for parallel execution
	workers: process.env.CI ? 4 : undefined,

	// Reporter configuration
	reporter: [["html", { open: "never" }], ["list"]],

	// Global timeout for each test
	timeout: 30000,

	// Shared settings for all projects
	use: {
		// Base URL for API requests
		baseURL: "http://localhost:8080",

		// Collect trace when retrying the failed test
		trace: "on-first-retry",

		// Extra HTTP headers for API requests
		extraHTTPHeaders: {
			"Content-Type": "application/json",
		},
	},

	// Define test projects
	projects: [
		{
			name: "api",
			testMatch: /.*\/api\/.*\.spec\.ts/,
			// API tests don't need a browser
			use: {
				// No browser configuration needed for API tests
			},
		},
		{
			name: "chromium",
			testMatch: /.*\/ui\/.*\.spec\.ts/,
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
