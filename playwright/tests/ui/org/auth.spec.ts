import { test, expect } from "@playwright/test";
import { orgLogin, ORG_UI_URL } from "../../../lib/org-ui-helpers";
import { randomUUID } from "crypto";
import {
	createTestOrgAdminDirect,
	deleteTestOrgByDomain,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";

test.describe("Org UI Authentication", () => {
	let testEmail: string;
	let testDomain: string;

	test.beforeEach(async () => {
		testDomain = `org-auth-ui-${randomUUID().substring(0, 8)}.com`;
		testEmail = `admin@${testDomain}`;

		// Create Org and Org Admin directly in DB (verified domain)
		await createTestOrgAdminDirect(testEmail, TEST_PASSWORD, "ind1");
	});

	test.afterEach(async () => {
		await deleteTestOrgByDomain(testDomain).catch(() => {});
	});

	test("should login successfully with TFA", async ({ page }) => {
		await page.goto(`${ORG_UI_URL}/login`);

		// Fill login form
		await page.fill(
			'input[placeholder="Company Domain (e.g., acme.com)"]',
			testDomain
		);
		await page.fill('input[placeholder="Email"]', testEmail);
		await page.fill('input[placeholder="Password"]', TEST_PASSWORD);
		await page.click('button:has-text("Login")');

		// Should be on TFA page
		await expect(page).toHaveURL(`${ORG_UI_URL}/tfa`);
		await expect(page.locator("text=Two-Factor Authentication")).toBeVisible();

		// Get TFA code via Org email (default helper works if email is correct)
		// Wait, org emails are sent to the user email
		const { getTfaCodeFromEmail } = require("../../../lib/mailpit");
		const tfaCode = await getTfaCodeFromEmail(testEmail);

		// Fill TFA code
		await page.fill('input[placeholder="Enter 6-digit code"]', tfaCode);
		await page.click('button:has-text("Verify")');

		// Should be on Dashboard
		await expect(page).toHaveURL(`${ORG_UI_URL}/`, { timeout: 10000 });
		await expect(page.locator("text=Org Dashboard")).toBeVisible();
	});

	test("should logout successfully", async ({ page }) => {
		await orgLogin(page, testDomain, testEmail, TEST_PASSWORD);

		// Logout
		await page.click(".ant-avatar"); // Open user menu
		await page.click("text=Logout");

		// Should be back at login
		await expect(page).toHaveURL(`${ORG_UI_URL}/login`);
	});
});
