import { test, expect } from "@playwright/test";

test.describe("Signup Complete Form Auto Test", () => {
	test("automated signup flow test", async ({ page }) => {
		// Use the test token provided
		const testUrl =
			"http://localhost:5173/signup/verify?token=2552508bb21a6cd866e4777dd82bbdc13328596330217004202d4745cd476d2c";

		// Listen for console messages
		page.on("console", (msg) => {
			console.log(`BROWSER CONSOLE [${msg.type()}]:`, msg.text());
		});

		await page.goto(testUrl);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		console.log("\n=== STEP 0: Initial Page ===");
		await page.screenshot({ path: "screenshots/auto-step0-initial.png" });

		// Step 1: Select Language
		console.log("\n=== STEP 1: Selecting Language ===");

		// Click on the language select dropdown
		await page.click('[id="signup-complete_preferred_language"]');
		await page.waitForTimeout(500);
		await page.screenshot({ path: "screenshots/auto-step1-dropdown-open.png" });

		// Select the first language option (English)
		const firstOption = page.locator(".ant-select-item-option").first();
		await firstOption.click();
		await page.waitForTimeout(500);
		await page.screenshot({ path: "screenshots/auto-step1-language-selected.png" });

		// Log form state
		const languageValue = await page.evaluate(() => {
			const form = document.querySelector("form");
			const input = form?.querySelector(
				'[id="signup-complete_preferred_language"]'
			);
			return (input as HTMLInputElement)?.value || "not found";
		});
		console.log("Selected language value:", languageValue);

		// Click Next
		await page.click('button:has-text("Next")');
		await page.waitForTimeout(500);
		await page.screenshot({ path: "screenshots/auto-step2-display-name.png" });

		// Step 2: Enter Display Name
		console.log("\n=== STEP 2: Display Name ===");

		// Check if the display name input is visible
		const displayNameInput = page.locator(
			'input[placeholder="Your name as you\'d like it displayed"]'
		);
		const isVisible = await displayNameInput.isVisible();
		console.log("Display name input visible:", isVisible);

		if (isVisible) {
			await displayNameInput.fill("Test User Name");
			await page.waitForTimeout(500);
			console.log("Filled display name: Test User Name");
		} else {
			console.log("ERROR: Display name input not visible!");
			// Take a screenshot of the current state
			await page.screenshot({
				path: "screenshots/auto-step2-error-no-input.png",
			});

			// Try to find what's on the page
			const pageContent = await page.content();
			console.log("Page contains 'display_name':", pageContent.includes("display_name"));
			console.log("Page contains 'display-name':", pageContent.includes("display-name"));
		}

		await page.screenshot({
			path: "screenshots/auto-step2-display-name-filled.png",
		});

		// Click Next
		await page.click('button:has-text("Next")');
		await page.waitForTimeout(500);
		await page.screenshot({ path: "screenshots/auto-step3-region.png" });

		// Step 3: Select Region and Country
		console.log("\n=== STEP 3: Region and Country ===");

		// Select Region using Ant Design select
		await page.locator('[id="signup-complete_home_region"]').click();
		await page.waitForTimeout(300);
		// Click the first visible option in the active dropdown
		await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click();
		await page.waitForTimeout(300);
		console.log("Selected region");

		// Select Country
		await page.locator('[id="signup-complete_resident_country_code"]').click();
		await page.waitForTimeout(300);
		await page.keyboard.type("United States");
		await page.waitForTimeout(500);
		await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click();
		await page.waitForTimeout(300);
		console.log("Selected country");

		await page.screenshot({ path: "screenshots/auto-step3-region-filled.png" });

		// Click Next
		await page.click('button:has-text("Next")');
		await page.waitForTimeout(500);
		await page.screenshot({ path: "screenshots/auto-step4-password.png" });

		// Step 4: Password
		console.log("\n=== STEP 4: Password ===");

		const passwordInput = page.locator(
			'input[placeholder="Choose a strong password"]'
		);
		if (await passwordInput.isVisible()) {
			await passwordInput.fill("TestPassword123!");
			console.log("Filled password");
		}

		const confirmInput = page.locator(
			'input[placeholder="Re-enter your password"]'
		);
		if (await confirmInput.isVisible()) {
			await confirmInput.fill("TestPassword123!");
			console.log("Filled confirm password");
		}
		await page.waitForTimeout(500);
		await page.screenshot({
			path: "screenshots/auto-step4-password-filled.png",
		});

		// Click Next to go to Summary
		await page.click('button:has-text("Next")');
		await page.waitForTimeout(1000);
		await page.screenshot({ path: "screenshots/auto-step5-summary.png" });

		// Step 5: Summary
		console.log("\n=== STEP 5: Summary ===");

		// Get the summary content - use .ant-descriptions for the summary table
		const summaryCard = page.locator(".ant-descriptions").first();
		if (await summaryCard.isVisible({ timeout: 3000 })) {
			const summaryText = await summaryCard.textContent();
			console.log("Summary card content:", summaryText);
		} else {
			console.log("Summary descriptions not visible, checking page...");
			await page.screenshot({ path: "screenshots/auto-step5-debug.png" });
		}

		// Check for the descriptions
		const descriptions = page.locator(".ant-descriptions-item-content");
		const count = await descriptions.count();
		console.log("Number of description items:", count);

		for (let i = 0; i < count; i++) {
			const text = await descriptions.nth(i).textContent();
			console.log(`  Item ${i}:`, text);
		}

		// Try to submit
		console.log("\n=== Attempting Submit ===");
		const submitBtn = page.locator('button:has-text("Create Account")');
		if (await submitBtn.isVisible()) {
			await submitBtn.click();
			console.log("Clicked submit button");
			await page.waitForTimeout(3000);
			await page.screenshot({ path: "screenshots/auto-step6-after-submit.png" });

			// Check for errors
			const errorAlert = page.locator(".ant-alert-error");
			if (await errorAlert.isVisible()) {
				const errorText = await errorAlert.textContent();
				console.log("ERROR ALERT:", errorText);
			}
		} else {
			console.log("Submit button not visible!");
		}

		console.log("\n=== Test Complete ===");
		await page.waitForTimeout(2000);
	});
});
