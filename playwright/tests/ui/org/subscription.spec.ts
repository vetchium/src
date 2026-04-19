import { test, expect } from "@playwright/test";
import { orgLogin, ORG_UI_URL } from "../../../lib/org-ui-helpers";
import {
	createTestOrgAdminDirect,
	deleteTestOrgByDomain,
	generateTestOrgEmail,
	setOrgTier,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";

// ============================================================================
// /settings/subscription
// ============================================================================
test.describe("Org UI — Subscription Page", () => {
	test("/settings/subscription shows Free tier, usage rows, and Upgrade button", async ({
		page,
	}) => {
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("sub-ui-free").email,
			TEST_PASSWORD
		);
		try {
			await orgLogin(page, domain, email, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/settings/subscription`);

			await expect(page.locator("text=Subscription")).toBeVisible({
				timeout: 10000,
			});
			await expect(page.locator("text=Free")).toBeVisible({ timeout: 5000 });

			// Usage rows
			await expect(page.locator("text=/org user|users/i").first()).toBeVisible({
				timeout: 5000,
			});

			// Upgrade to Silver button should exist (Silver is self-upgradeable)
			const upgradeBtn = page.locator("button:has-text(/upgrade to silver/i)");
			if ((await upgradeBtn.count()) > 0) {
				await expect(upgradeBtn).toBeVisible();
			} else {
				// May be styled differently — look for any upgrade button
				const anyUpgrade = page.locator("button:has-text(/upgrade/i)").first();
				await expect(anyUpgrade).toBeVisible({ timeout: 5000 });
			}
		} finally {
			await deleteTestOrgByDomain(domain);
		}
	});

	test("Upgrade to Silver: confirm modal -> tier flips to Silver", async ({
		page,
	}) => {
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("sub-ui-upgrade").email,
			TEST_PASSWORD
		);
		try {
			await orgLogin(page, domain, email, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/settings/subscription`);

			await expect(page.locator("text=Subscription")).toBeVisible({
				timeout: 10000,
			});
			await expect(page.locator("text=Free")).toBeVisible({ timeout: 5000 });

			// Click Upgrade to Silver
			const upgradeBtn = page
				.locator("button", { hasText: /upgrade to silver/i })
				.first();
			if ((await upgradeBtn.count()) === 0) {
				// Try generic upgrade button
				await page.locator("button:has-text(/upgrade/i)").first().click();
			} else {
				await upgradeBtn.click();
			}

			// Confirm modal should appear
			const modal = page.locator(".ant-modal");
			await expect(modal).toBeVisible({ timeout: 5000 });

			// Click confirm/OK
			const confirmBtn = modal
				.locator("button:has-text(/confirm|ok|upgrade/i)")
				.first();
			await confirmBtn.click();

			// After upgrade, Silver should appear
			await expect(page.locator("text=/silver/i").first()).toBeVisible({
				timeout: 10000,
			});
		} finally {
			await deleteTestOrgByDomain(domain);
		}
	});

	test("Enterprise tier has no Upgrade button", async ({ page }) => {
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("sub-ui-ent").email,
			TEST_PASSWORD
		);
		try {
			await setOrgTier(orgId, "enterprise");
			await orgLogin(page, domain, email, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/settings/subscription`);

			await expect(page.locator("text=Subscription")).toBeVisible({
				timeout: 10000,
			});
			await expect(page.locator("text=/enterprise/i").first()).toBeVisible({
				timeout: 5000,
			});

			// There should be no "Upgrade" button when on Enterprise
			const upgradeBtn = page.locator("button:has-text(/upgrade/i)");
			const count = await upgradeBtn.count();
			expect(count).toBe(0);
		} finally {
			await deleteTestOrgByDomain(domain);
		}
	});
});
