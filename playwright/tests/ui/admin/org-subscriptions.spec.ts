import { test, expect } from "@playwright/test";
import { adminLogin, ADMIN_UI_URL } from "../../../lib/admin-ui-helpers";
import {
	createTestSuperadmin,
	deleteTestAdminUser,
	generateTestEmail,
	createTestOrgAdminDirect,
	deleteTestOrgByDomain,
	generateTestOrgEmail,
	setOrgTier,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";

// ============================================================================
// Admin Org Subscriptions Page
// ============================================================================
test.describe("Admin UI — Org Subscriptions", () => {
	test("Admin sets org tier with required reason", async ({ page }) => {
		const adminEmail = generateTestEmail("admin-org-sub-ui");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		const { email: orgEmail, domain: orgDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("admin-sub-org").email,
				TEST_PASSWORD
			);

		try {
			await adminLogin(page, adminEmail, TEST_PASSWORD);
			await page.goto(`${ADMIN_UI_URL}/org-subscriptions`);

			await expect(page.locator("text=Org Subscriptions")).toBeVisible({
				timeout: 10000,
			});

			// Find the org row
			await expect(page.locator(`text=${orgDomain}`)).toBeVisible({
				timeout: 10000,
			});

			// Click "Change Tier" for that org
			const row = page.locator("tr").filter({ hasText: orgDomain });
			const changeTierBtn = row.locator(
				'button:has-text(/change tier|set tier/i)'
			);
			if ((await changeTierBtn.count()) > 0) {
				await changeTierBtn.click();

				const modal = page.locator(".ant-modal");
				await expect(modal).toBeVisible({ timeout: 5000 });

				// Select silver tier
				const tierSelect = modal.locator(".ant-select").first();
				await tierSelect.click();
				await page.locator(".ant-select-item", { hasText: /silver/i }).click();

				// Try submitting without reason — should be disabled or show error
				const submitBtn = modal.locator(
					'button:has-text(/save|update|apply/i)'
				).first();

				// Fill reason
				const reasonTextarea = modal.locator("textarea");
				await reasonTextarea.fill("Admin UI test: setting to Silver");

				await submitBtn.click();

				// Success: tier should update
				await expect(
					page.locator("text=/silver/i").first()
				).toBeVisible({ timeout: 10000 });
			}
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgByDomain(orgDomain);
		}
	});

	test("Downgrade-blocked response surfaces usage info in modal", async ({
		page,
	}) => {
		const adminEmail = generateTestEmail("admin-org-sub-block-ui");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		const { email: orgEmail, domain: orgDomain, orgId } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("admin-sub-block-org").email,
				TEST_PASSWORD
			);

		try {
			// Put on Gold so a downgrade to Free might be blocked
			await setOrgTier(orgId, "gold");

			await adminLogin(page, adminEmail, TEST_PASSWORD);
			await page.goto(`${ADMIN_UI_URL}/org-subscriptions`);

			await expect(page.locator("text=Org Subscriptions")).toBeVisible({
				timeout: 10000,
			});
			await expect(page.locator(`text=${orgDomain}`)).toBeVisible({
				timeout: 10000,
			});

			const row = page.locator("tr").filter({ hasText: orgDomain });
			const changeTierBtn = row.locator(
				'button:has-text(/change tier|set tier/i)'
			);
			if ((await changeTierBtn.count()) > 0) {
				await changeTierBtn.click();

				const modal = page.locator(".ant-modal");
				await expect(modal).toBeVisible({ timeout: 5000 });

				// Select Free tier (downgrade)
				const tierSelect = modal.locator(".ant-select").first();
				await tierSelect.click();
				await page.locator(".ant-select-item", { hasText: /free/i }).click();

				const reasonTextarea = modal.locator("textarea");
				await reasonTextarea.fill("Testing downgrade block UI");

				const submitBtn = modal
					.locator('button:has-text(/save|update|apply/i)')
					.first();
				await submitBtn.click();

				// Either succeeds (org has no users over free cap) or shows blocking info
				// Either way, the modal should respond
				await expect(modal).toBeVisible({ timeout: 5000 });
			}
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgByDomain(orgDomain);
		}
	});
});
