import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	deleteTestHubUser,
	generateTestDomainName,
	createTestApprovedDomain,
	permanentlyDeleteTestApprovedDomain,
	extractSignupTokenFromEmail,
} from "../../../lib/db";
import { waitForEmail, getEmailContent } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

// Hub UI base URL
const HUB_UI_URL = "http://localhost:5173";

test.describe("Signup Complete Form Auto Test", () => {
	test("automated signup flow test", async ({ page, request }) => {
		// Set up test data
		const adminEmail = `admin-signup-ui-${randomUUID()}@test.vetchium.com`;
		const domain = generateTestDomainName("signup-ui");
		const userEmail = `test-${randomUUID().substring(0, 8)}@${domain}`;

		// Create admin and approved domain
		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		let signupToken: string | null = null;

		try {
			// Request signup via API to get a valid token
			const signupResponse = await request.post(
				"http://localhost:8080/hub/request-signup",
				{
					data: { email_address: userEmail },
				}
			);
			expect(signupResponse.status()).toBe(200);

			// Get token from email
			const emailSummary = await waitForEmail(userEmail);
			const emailMessage = await getEmailContent(emailSummary.ID);
			signupToken = extractSignupTokenFromEmail(emailMessage);
			expect(signupToken).not.toBeNull();

			// Build the test URL with the dynamic token
			const testUrl = `${HUB_UI_URL}/signup/verify?token=${signupToken}`;

			// Listen for console messages (for debugging)
			page.on("console", (msg) => {
				if (msg.type() === "error") {
					console.log(`BROWSER ERROR:`, msg.text());
				}
			});

			await page.goto(testUrl);
			await page.waitForLoadState("networkidle");
			await page.waitForTimeout(1000);

			// Step 1: Select Language
			await page.click('[id="signup-complete_preferred_language"]');
			await page.waitForTimeout(500);

			// Select the first language option (English)
			const firstOption = page.locator(".ant-select-item-option").first();
			await firstOption.click();
			await page.waitForTimeout(500);

			// Click Next
			await page.click('button:has-text("Next")');
			await page.waitForTimeout(500);

			// Step 2: Enter Display Name
			const displayNameInput = page.locator(
				'input[placeholder="Your name as you\'d like it displayed"]'
			);
			const isVisible = await displayNameInput.isVisible();
			expect(isVisible).toBe(true);

			if (isVisible) {
				await displayNameInput.fill("Test User Name");
				await page.waitForTimeout(500);
			}

			// Click Next
			await page.click('button:has-text("Next")');
			await page.waitForTimeout(500);

			// Step 3: Select Region and Country
			// Select Region using Ant Design select
			await page.locator('[id="signup-complete_home_region"]').click();
			await page.waitForTimeout(300);
			// Click the first visible option in the active dropdown
			await page
				.locator(
					".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option"
				)
				.first()
				.click();
			await page.waitForTimeout(300);

			// Select Country
			await page
				.locator('[id="signup-complete_resident_country_code"]')
				.click();
			await page.waitForTimeout(300);
			await page.keyboard.type("United States");
			await page.waitForTimeout(500);
			await page
				.locator(
					".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option"
				)
				.first()
				.click();
			await page.waitForTimeout(300);

			// Click Next
			await page.click('button:has-text("Next")');
			await page.waitForTimeout(500);

			// Step 4: Password
			const passwordInput = page.locator(
				'input[placeholder="Choose a strong password"]'
			);
			if (await passwordInput.isVisible()) {
				await passwordInput.fill(TEST_PASSWORD);
			}

			const confirmInput = page.locator(
				'input[placeholder="Re-enter your password"]'
			);
			if (await confirmInput.isVisible()) {
				await confirmInput.fill(TEST_PASSWORD);
			}
			await page.waitForTimeout(500);

			// Click Next to go to Summary
			await page.click('button:has-text("Next")');
			await page.waitForTimeout(1000);

			// Step 5: Summary - Verify summary is displayed
			const summaryCard = page.locator(".ant-descriptions").first();
			await expect(summaryCard).toBeVisible({ timeout: 5000 });

			// Verify some summary content exists
			const descriptions = page.locator(".ant-descriptions-item-content");
			const count = await descriptions.count();
			expect(count).toBeGreaterThan(0);

			// Submit the form
			const submitBtn = page.locator('button:has-text("Create Account")');
			await expect(submitBtn).toBeVisible();
			await submitBtn.click();
			await page.waitForTimeout(3000);

			// Check for success - should redirect to login or show success message
			// Check for absence of error alerts
			const errorAlert = page.locator(".ant-alert-error");
			const hasError = await errorAlert.isVisible().catch(() => false);

			if (hasError) {
				const errorText = await errorAlert.textContent();
				console.log("Error during signup:", errorText);
			}

			// Expect no errors after submit
			expect(hasError).toBe(false);
		} finally {
			// Cleanup
			await deleteTestHubUser(userEmail).catch(() => {});
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});
});
