import { test, expect } from "@playwright/test";
import { adminLogin, ADMIN_UI_URL } from "../../../lib/admin-ui-helpers";
import { randomUUID } from "crypto";
import { deleteTestAdminUser, createTestSuperadmin } from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";

test.describe("Admin UI - User Management", () => {
	let testUserEmail: string;
	let testAdminEmail: string;

	test.beforeEach(async ({ page }) => {
		testAdminEmail = `admin-users-ui-${randomUUID().substring(0, 8)}@test.vetchium.com`;
		await createTestSuperadmin(testAdminEmail, TEST_PASSWORD);
		testUserEmail = `test-admin-${randomUUID().substring(0, 8)}@test.vetchium.com`;
		await adminLogin(page, testAdminEmail, TEST_PASSWORD);
	});

	test.afterEach(async () => {
		if (testUserEmail) {
			await deleteTestAdminUser(testUserEmail).catch(() => {});
		}
		if (testAdminEmail) {
			await deleteTestAdminUser(testAdminEmail).catch(() => {});
		}
	});

	test("should invite a new admin user", async ({ page }) => {
		// Navigate to User Management
		await page.click("text=User Management");
		await expect(page).toHaveURL(`${ADMIN_UI_URL}/users`);

		// Click Invite User button on the User Management page
		await page.locator('button:has-text("Invite User")').click();

		// Wait for the modal to appear
		const modal = page.locator(".ant-modal").filter({ hasText: "Invite User" });
		await expect(modal).toBeVisible();

		// Fill Invite Modal - use label-based selection if possible, or placeholder
		await modal
			.getByPlaceholder("user@example.com", { exact: false })
			.fill(testUserEmail);

		// Select language
		await modal.getByLabel("Invitation Email Language").click();
		await page
			.locator('.ant-select-item-option:has-text("en-US")')
			.first()
			.click();

		// Submit (Click the "Invite User" button in the modal footer)
		await modal
			.locator('.ant-modal-footer button:has-text("Invite User")')
			.click();

		// Verify success
		await expect(
			page
				.locator(".ant-message-success")
				.filter({ hasText: "User invited successfully" })
		).toBeVisible();

		// Re-navigate to get a clean page state (avoids race between search fetch
		// and the invite-success auto-refresh fetch)
		await page.goto(`${ADMIN_UI_URL}/users`);
		await page.waitForLoadState("networkidle");

		// Search for invited user
		const searchInput = page.locator(
			'input[placeholder="Search by email or name..."]'
		);
		await searchInput.fill(testUserEmail);
		await page.waitForLoadState("networkidle");

		// Wait for user to appear in the table
		const row = page.locator("tbody tr").filter({ hasText: testUserEmail });
		await expect(row).toBeVisible({ timeout: 15000 });

		// Verify invited status
		await expect(row).toContainText("invited", {
			ignoreCase: true,
			timeout: 10000,
		});
	});
});
