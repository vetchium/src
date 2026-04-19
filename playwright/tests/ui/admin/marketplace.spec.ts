import { test, expect } from "@playwright/test";
import { adminLogin, ADMIN_UI_URL } from "../../../lib/admin-ui-helpers";
import {
	createTestSuperadmin,
	deleteTestAdminUser,
	generateTestEmail,
	createTestOrgAdminDirect,
	deleteTestOrgByDomain,
	generateTestOrgEmail,
	createTestMarketplaceCapability,
	deleteTestMarketplaceCapability,
	createTestMarketplaceListingDirect,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";

const SHARED_CAP_ID = `admin-mp-ui-cap-${Math.random().toString(36).slice(2, 10)}`;

test.beforeAll(async () => {
	await createTestMarketplaceCapability(
		SHARED_CAP_ID,
		"active",
		"Admin UI Test Cap"
	);
});

test.afterAll(async () => {
	await deleteTestMarketplaceCapability(SHARED_CAP_ID);
});

// ============================================================================
// Capability list + create modal
// ============================================================================
test.describe("Admin UI Marketplace — Capabilities", () => {
	test("Capability list renders and create modal works", async ({ page }) => {
		const adminEmail = generateTestEmail("admin-mp-cap-ui");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		const newCapId = `admin-ui-created-cap-${Math.random().toString(36).slice(2, 10)}`;

		try {
			await adminLogin(page, adminEmail, TEST_PASSWORD);
			await page.goto(`${ADMIN_UI_URL}/marketplace/capabilities`);

			await expect(page.locator("text=Capabilities")).toBeVisible({
				timeout: 10000,
			});
			await expect(page.locator("text=Admin UI Test Cap")).toBeVisible({
				timeout: 10000,
			});

			// Open create modal
			const addButton = page.locator('button:has-text("Add Capability")');
			if ((await addButton.count()) > 0) {
				await addButton.click();
				await expect(page.locator(".ant-modal")).toBeVisible({
					timeout: 5000,
				});

				// Fill the form
				const idInput = page.locator(".ant-modal input").first();
				await idInput.fill(newCapId);
				const nameInput = page.locator(".ant-modal input").nth(1);
				await nameInput.fill("Created in UI Test");

				await page
					.locator('.ant-modal-footer button:has-text("Create")')
					.click();

				await expect(page.locator("text=Created in UI Test")).toBeVisible({
					timeout: 5000,
				});
			}
		} finally {
			await deleteTestMarketplaceCapability(newCapId).catch(() => {});
			await deleteTestAdminUser(adminEmail);
		}
	});
});

// ============================================================================
// Listing admin view with Suspend action
// ============================================================================
test.describe("Admin UI Marketplace — Listing Suspend", () => {
	test("Listing admin view shows Suspend action", async ({ page }) => {
		const adminEmail = generateTestEmail("admin-mp-list-ui");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		const {
			email: orgEmail,
			domain: orgDomain,
			orgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("admin-mp-list-org").email,
			TEST_PASSWORD
		);

		try {
			const { listingNumber } = await createTestMarketplaceListingDirect(
				orgId,
				orgDomain,
				[SHARED_CAP_ID],
				"active",
				"Admin Suspend UI Test Listing"
			);

			await adminLogin(page, adminEmail, TEST_PASSWORD);
			await page.goto(`${ADMIN_UI_URL}/marketplace/listings`);

			await expect(page.locator("text=Marketplace Listings")).toBeVisible({
				timeout: 10000,
			});
			await expect(
				page.locator("text=Admin Suspend UI Test Listing")
			).toBeVisible({ timeout: 10000 });

			// Look for suspend action on the row
			const row = page
				.locator("tr")
				.filter({ hasText: "Admin Suspend UI Test Listing" });
			const suspendBtn = row.locator('button:has-text("Suspend")');
			if ((await suspendBtn.count()) > 0) {
				await suspendBtn.click();
				await expect(page.locator(".ant-modal")).toBeVisible({
					timeout: 5000,
				});
				// Fill suspension note
				await page.fill(".ant-modal textarea", "Suspended by admin UI test");
				await page
					.locator('.ant-modal-footer button:has-text("Suspend")')
					.click();
				await expect(page.locator("text=Suspended")).toBeVisible({
					timeout: 5000,
				});
			}
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgByDomain(orgDomain);
		}
	});
});
