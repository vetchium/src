import { test, expect } from "@playwright/test";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import { createTestSuperadmin, deleteTestAdminUser } from "../../../lib/db";
import { randomUUID } from "crypto";

const ADMIN_UI_URL = "http://localhost:3001";

test.describe("Admin UI Authentication", () => {
	let testEmail: string;

	test.beforeEach(async () => {
		testEmail = `admin-auth-ui-${randomUUID().substring(0, 8)}@test.vetchium.com`;
		await createTestSuperadmin(testEmail, TEST_PASSWORD);
	});

	test.afterEach(async () => {
		await deleteTestAdminUser(testEmail).catch(() => {});
	});

	test("should login successfully with TFA", async ({ page }) => {
		await page.goto(`${ADMIN_UI_URL}/login`);

		// Fill login form
		await page.fill('input[placeholder="Email"]', testEmail);
		await page.fill('input[placeholder="Password"]', TEST_PASSWORD);
		await page.click('button:has-text("Login")');

		// Should be on TFA page
		await expect(page).toHaveURL(`${ADMIN_UI_URL}/tfa`);
		await expect(page.locator("text=Two-Factor Authentication")).toBeVisible();

		// Get TFA code from Mailpit
		const tfaCode = await getTfaCodeFromEmail(testEmail);

		// Fill TFA code
		await page.fill('input[placeholder="Enter 6-digit code"]', tfaCode);
		await page.click('button:has-text("Verify")');

		// Should be on Dashboard
		await expect(page).toHaveURL(`${ADMIN_UI_URL}/`, { timeout: 10000 });
		await expect(page.locator("text=Admin Dashboard")).toBeVisible();
	});

	test("should logout successfully", async ({ page }) => {
		// First login
		await page.goto(`${ADMIN_UI_URL}/login`);
		await page.fill('input[placeholder="Email"]', testEmail);
		await page.fill('input[placeholder="Password"]', TEST_PASSWORD);
		await page.click('button:has-text("Login")');
		const tfaCode = await getTfaCodeFromEmail(testEmail);
		await page.fill('input[placeholder="Enter 6-digit code"]', tfaCode);
		await page.click('button:has-text("Verify")');
		await expect(page).toHaveURL(`${ADMIN_UI_URL}/`);

		// Logout via header dropdown
		await page.click(".ant-avatar"); // Open user menu
		await page.click("text=Logout");

		// Should be back at login
		await expect(page).toHaveURL(`${ADMIN_UI_URL}/login`);
	});
});
