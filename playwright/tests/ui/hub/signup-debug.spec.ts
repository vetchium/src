import { test, expect } from "@playwright/test";

test.describe("Signup Complete Form Debug", () => {
	test("manual test - opens browser and pauses", async ({ page }) => {
		// Use the test token provided
		const testUrl =
			"http://localhost:5173/signup/verify?token=2552508bb21a6cd866e4777dd82bbdc13328596330217004202d4745cd476d2c";

		await page.goto(testUrl);

		// Wait for the page to load
		await page.waitForLoadState("networkidle");

		console.log("Browser is open. Please manually test the signup flow.");
		console.log("The test will remain open for 5 minutes.");
		console.log(
			"Check: 1) Can you select a language? 2) Does the display name field appear? 3) Does the summary show values? 4) Does the submit work?"
		);

		// Pause so we can interact manually
		await page.pause();
	});
});
