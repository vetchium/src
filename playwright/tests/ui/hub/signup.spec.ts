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
import { antdSelect } from "../../../lib/ui-helpers";

// Hub UI base URL from Docker
const HUB_UI_URL = "http://localhost:3000";

test.describe("Hub UI - Signup Flow", () => {
    let adminEmail: string;
    let domain: string;
    let userEmail: string;

    test.beforeEach(async () => {
        adminEmail = `admin-signup-ui-${randomUUID().substring(0, 8)}@test.vetchium.com`;
		domain = generateTestDomainName("signup-ui");
		userEmail = `test-${randomUUID().substring(0, 8)}@${domain}`;

		// Create admin and approved domain
		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);
    });

    test.afterEach(async () => {
        await deleteTestHubUser(userEmail).catch(() => {});
        await permanentlyDeleteTestApprovedDomain(domain);
        await deleteTestAdminUser(adminEmail);
    });

	test("should complete the full signup flow successfully", async ({ page }) => {
		// 1. Request signup link
        await page.goto(`${HUB_UI_URL}/signup`);
        await page.fill('input[placeholder="Enter your professional email"]', userEmail);
        await page.click('button:has-text("Request Verification Email")');

        // Verify success message
        await expect(page.locator(".ant-alert-success")).toBeVisible();
        await expect(page.locator(".ant-alert-success")).toContainText("Verification email sent");

		// 2. Get token from email
		const emailSummary = await waitForEmail(userEmail);
		const emailMessage = await getEmailContent(emailSummary.ID);
		const signupToken = extractSignupTokenFromEmail(emailMessage);
		expect(signupToken).not.toBeNull();

		// 3. Complete Signup Form
		await page.goto(`${HUB_UI_URL}/signup/verify?token=${signupToken}`);
		
		// Step 1: Select Language
		await antdSelect(page, '[id="signup-complete_preferred_language"]', "English");
		await page.click('button:has-text("Next")');

		// Step 2: Enter Display Name
		await page.fill('input[placeholder="Your name as you\'d like it displayed"]', "UI Test User");
		await page.click('button:has-text("Next")');

		// Step 3: Select Region and Country
		await antdSelect(page, '[id="signup-complete_home_region"]', "India");
		await antdSelect(page, '[id="signup-complete_resident_country_code"]', "United States", "United States");
		await page.click('button:has-text("Next")');

		// Step 4: Password
		await page.fill('input[placeholder="Choose a strong password"]', TEST_PASSWORD);
		await page.fill('input[placeholder="Re-enter your password"]', TEST_PASSWORD);
		await page.click('button:has-text("Next")');

		// Step 5: Summary
		await expect(page.locator(".ant-descriptions")).toBeVisible();
		await page.click('button:has-text("Create Account")');

		// 4. Verify completion
		await expect(page).toHaveURL(`${HUB_UI_URL}/`, { timeout: 10000 });
		await expect(page.locator("text=Welcome to Vetchium Hub")).toBeVisible();
        await expect(page.locator("text=Login Successful")).toBeVisible();
	});
});
