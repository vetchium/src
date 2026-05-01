import { test, expect } from "@playwright/test";
import {
	orgLogin,
	ORG_UI_URL,
	addAddress,
	gotoAddresses,
} from "../../../lib/org-ui-helpers";
import {
	createTestOrgAdminDirect,
	deleteTestOrgByDomain,
	generateTestOrgEmail,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";

test.describe("Org UI Company Addresses", () => {
	let testUser: { email: string; domain: string; orgId: string };

	test.beforeEach(async () => {
		testUser = await createTestOrgAdminDirect(
			generateTestOrgEmail("addr-ui").email,
			TEST_PASSWORD
		);
	});

	test.afterEach(async () => {
		if (testUser) {
			await deleteTestOrgByDomain(testUser.domain);
		}
	});

	test("Admin can CRUD company addresses", async ({ page }) => {
		await orgLogin(page, testUser.domain, testUser.email, TEST_PASSWORD);

		// 1. Navigate to addresses via dashboard tile
		await page.locator("text=Company Addresses").click();
		await expect(page).toHaveURL(`${ORG_UI_URL}/settings/addresses`);
		await expect(
			page.locator('h2:has-text("Company Addresses")')
		).toBeVisible();

		// 2. Create address
		const addr1 = {
			title: "HQ Office",
			addressLine1: "123 Main St",
			city: "London",
			country: "UK",
		};
		await addAddress(page, addr1);
		await expect(
			page.locator("text=Address created successfully")
		).toBeVisible();
		await expect(page.locator("text=HQ Office")).toBeVisible();
		await expect(page.locator("text=123 Main St")).toBeVisible();

		// 3. Edit address
		await page.click('button:has-text("Edit")');
		const editModal = page.locator(".ant-modal-content");
		await expect(editModal).toBeVisible();
		await editModal.getByLabel("Title").fill("Global HQ");
		await page.click('button:has-text("Save Address")');
		await expect(
			page.locator("text=Address updated successfully")
		).toBeVisible();
		await expect(page.locator("text=Global HQ")).toBeVisible();

		// 4. Disable address
		await page.click('button:has-text("Disable")');
		await page.click('button:has-text("Yes")');
		await expect(page.locator("text=Address disabled")).toBeVisible();
		await expect(page.locator("text=Disabled")).toBeVisible();

		// 5. Re-enable address
		await page.click('button:has-text("Re-enable")');
		await page.click('button:has-text("Yes")');
		await expect(page.locator("text=Address re-enabled")).toBeVisible();
		await expect(page.locator("text=Active")).toBeVisible();
	});

	test("Addresses page handles empty state and filters", async ({ page }) => {
		await orgLogin(page, testUser.domain, testUser.email, TEST_PASSWORD);
		await gotoAddresses(page);

		// Empty state
		await expect(page.locator("text=No data")).toBeVisible();

		// Create one address
		await addAddress(page, {
			title: "Remote Office",
			addressLine1: "456 Side St",
			city: "Berlin",
			country: "Germany",
		});

		// Filter active
		await page.click('.ant-tabs-tab:has-text("Active")');
		await expect(page.locator("text=Remote Office")).toBeVisible();

		// Filter disabled
		await page.click('.ant-tabs-tab:has-text("Disabled")');
		await expect(page.locator("text=Remote Office")).not.toBeVisible();
		await expect(page.locator("text=No data")).toBeVisible();
	});
});
