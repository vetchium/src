import { test, expect } from "@playwright/test";
import { orgLogin, ORG_UI_URL } from "../../../lib/org-ui-helpers";
import { randomUUID } from "crypto";
import {
	createTestOrgAdminDirect,
	deleteTestOrgByDomain,
	deleteTestGlobalOrgDomain,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";

test.describe("Org UI - Domains", () => {
	let testEmail: string;
	let testDomain: string;
	let newDomain: string;

	test.beforeEach(async ({ page }) => {
		testDomain = `org-domains-ui-${randomUUID().substring(0, 8)}.com`;
		testEmail = `admin@${testDomain}`;
		newDomain = `new-domain-${randomUUID().substring(0, 8)}.com`;

		await createTestOrgAdminDirect(testEmail, TEST_PASSWORD, "ind1");
		await orgLogin(page, testDomain, testEmail, TEST_PASSWORD);
	});

	test.afterEach(async () => {
		await deleteTestOrgByDomain(testDomain).catch(() => {});
		if (newDomain) {
			await deleteTestGlobalOrgDomain(newDomain).catch(() => {});
		}
	});

	test("should claim a new domain and see DNS instructions", async ({
		page,
	}) => {
		// Navigate to Domains
		await page.click("text=Domains");
		await expect(page).toHaveURL(`${ORG_UI_URL}/domains`);

		// Fill claim form
		await page.fill('input[placeholder="example.com"]', newDomain);
		await page.click('button:has-text("Claim Domain")');

		// Verify success alert with instructions
		await expect(page.locator(".ant-alert-success")).toBeVisible();
		await expect(page.locator(".ant-alert-success")).toContainText(
			"DNS Configuration"
		);
		await expect(page.locator(".ant-alert-success")).toContainText(newDomain);

		// Verify it appears in the table
		await expect(
			page.locator("table").locator(`text=${newDomain}`)
		).toBeVisible();

		// Check status is PENDING (initially)
		const row = page.locator("tr").filter({ hasText: newDomain });
		await expect(row.locator('.ant-tag:has-text("Pending")')).toBeVisible();
	});
});
