import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestDomainName,
	createTestApprovedDomain,
	permanentlyDeleteTestApprovedDomain,
	extractSignupTokenFromEmail,
} from "../../../lib/db";
import { waitForEmail, getEmailContent } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

// Hub UI base URL
const HUB_UI_URL = "http://localhost:5173";

test.describe("Signup Complete Form Debug", () => {
	test("signup form validation test", async ({ page, request }) => {
		// Set up test data
		const adminEmail = `admin-signup-debug-${randomUUID()}@test.vetchium.com`;
		const domain = generateTestDomainName("signup-debug");
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

			await page.goto(testUrl);
			await page.waitForLoadState("networkidle");

			// Verify the signup form is loaded
			const form = page.locator("form");
			await expect(form).toBeVisible({ timeout: 10000 });

			// Check that the language selector is visible (first step)
			const languageSelector = page.locator(
				'[id="signup-complete_preferred_language"]'
			);
			await expect(languageSelector).toBeVisible();

			// Verify the Next button is present
			const nextButton = page.locator('button:has-text("Next")');
			await expect(nextButton).toBeVisible();
		} finally {
			// Cleanup - user won't be created since we're just testing form visibility
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});
});
