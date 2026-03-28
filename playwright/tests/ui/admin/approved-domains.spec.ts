import { test, expect } from "@playwright/test";
import { adminLogin, ADMIN_UI_URL } from "../../../lib/admin-ui-helpers";
import { randomUUID } from "crypto";
import {
	permanentlyDeleteTestApprovedDomain,
	createTestSuperadmin,
	deleteTestAdminUser,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";

test.describe("Admin UI - Approved Domains", () => {
	let domainName: string;
	let testAdminEmail: string;

	test.beforeEach(async ({ page }) => {
		testAdminEmail = `admin-domains-ui-${randomUUID().substring(0, 8)}@test.vetchium.com`;
		await createTestSuperadmin(testAdminEmail, TEST_PASSWORD);
		domainName = `test-domain-${randomUUID().substring(0, 8)}.com`;
		await adminLogin(page, testAdminEmail, TEST_PASSWORD);
	});

	test.afterEach(async () => {
		if (domainName) {
			await permanentlyDeleteTestApprovedDomain(domainName).catch(() => {});
		}
		if (testAdminEmail) {
			await deleteTestAdminUser(testAdminEmail).catch(() => {});
		}
	});

	test("should add, filter, and disable an approved domain", async ({
		page,
	}) => {
		// Navigate to Approved Domains
		await page.click("text=Approved Domains");
		await expect(page).toHaveURL(`${ADMIN_UI_URL}/approved-domains`);

		// Add a domain
		await page.click('button:has-text("Add Domain")');
		await page.fill('input[placeholder="example.com"]', domainName);
		await page.fill(
			'textarea[placeholder="Enter the reason for adding this domain..."]',
			"UI Testing auto-add"
		);
		await page.click('.ant-modal-footer button:has-text("Add")');

		// Verify success message
		await expect(
			page
				.locator(".ant-message-success")
				.filter({ hasText: "Domain added successfully" })
		).toBeVisible();

		// Verify it appears in the list (Active tab is default)
		await expect(page.locator(`text=${domainName}`)).toBeVisible();

		// Search for it
		await page.fill('input[placeholder="Search domains..."]', domainName);
		await expect(page.locator(`text=${domainName}`)).toBeVisible();

		// Disable it
		const row = page.locator("tr").filter({ hasText: domainName });
		await row.locator('button:has-text("Disable")').click();

		// Fill reason in modal
		await page.fill(
			'textarea[placeholder="Enter the reason for disabling this domain..."]',
			"UI Testing auto-disable"
		);
		await page.click('.ant-modal-footer button:has-text("Disable")');

		// Verify success
		await expect(
			page
				.locator(".ant-message-success")
				.filter({ hasText: "Domain disabled successfully" })
		).toBeVisible();

		// Verify it's gone from Active tab
		await expect(
			page.locator("table").locator(`text=${domainName}`)
		).not.toBeVisible();

		// Switch to Inactive tab and verify it's there
		await page.click('.ant-tabs-tab-btn:has-text("Inactive")');
		await expect(
			page.locator("table").locator(`text=${domainName}`)
		).toBeVisible();
	});
});
