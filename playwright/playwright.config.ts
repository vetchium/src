import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Vetchium API and UI tests.
 *
 * Environment requirements:
 * - All services must be running via `docker compose up` from src/
 * - API Server: http://localhost:8080 (nginx load balancer)
 * - Mailpit API: http://localhost:8025
 * - Global DB: postgresql://vetchium:vetchium_dev@localhost:5432/vetchium_global
 * - Hub UI: Started automatically by Playwright via webServer config
 */
export default defineConfig({
	testDir: "./tests",

	// Web server configuration to start hub-ui dev server before running UI tests
	webServer: {
		command: "cd ../hub-ui && bun run dev",
		url: "http://localhost:5173",
		reuseExistingServer: !process.env.CI,
		timeout: 120000,
	},

	// Run all tests in parallel - each test is fully independent
	fullyParallel: true,

	// Fail the build on CI if you accidentally left test.only in the source code
	forbidOnly: !!process.env.CI,

	// Retry on CI only
	retries: process.env.CI ? 2 : 0,

	// Use multiple workers for parallel execution - use all available CPU cores
	workers: process.env.CI ? 4 : "100%",

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
	},

	// Define test projects
	projects: [
		{
			name: "api",
			// Match API tests EXCEPT those requiring isolation
			testMatch: /.*\/api\/.*\.spec\.ts/,
			testIgnore: /.*last-admin-protection\.spec\.ts/,
			// API tests don't need a browser
			use: {
				// No browser configuration needed for API tests
			},
		},
		{
			name: "api-isolated",
			// Tests that require single-worker isolation (modify global state)
			testMatch: /.*last-admin-protection\.spec\.ts/,
			// Run after main API tests to avoid interference
			dependencies: ["api"],
			// Force serial execution within this project
			fullyParallel: false,
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
