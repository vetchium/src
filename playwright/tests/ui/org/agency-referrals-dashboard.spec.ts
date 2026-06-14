import { test, expect } from "@playwright/test";
import { orgLogin, ORG_UI_URL } from "../../../lib/org-ui-helpers";
import {
	createTestOrgAdminDirect,
	deleteTestOrgByDomain,
	generateTestOrgEmail,
	createTestMarketplaceListingDirect,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";

// The "Agency Referrals" dashboard tile is gated on the org being a registered
// staffing provider — i.e. it has an ACTIVE marketplace listing carrying the
// "staffing" capability. (The agency-side role is also required; superadmin —
// used here — satisfies that.) These tests verify the tile shows only for
// staffing providers and stays hidden otherwise.
const TILE_TEXT = "Agency Referrals";

test.describe("Org UI Dashboard — Agency Referrals tile", () => {
	test("tile is visible and navigates for an org with an active staffing listing", async ({
		page,
	}) => {
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("agref-tile-yes").email,
			TEST_PASSWORD
		);
		try {
			await createTestMarketplaceListingDirect(
				orgId,
				domain,
				["staffing"],
				"active",
				"Staffing Listing"
			);

			await orgLogin(page, domain, email, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/`);

			const tile = page.locator(`text=${TILE_TEXT}`);
			await expect(tile).toBeVisible({ timeout: 10000 });

			await tile.click();
			await expect(page).toHaveURL(`${ORG_UI_URL}/referrals`, {
				timeout: 10000,
			});
		} finally {
			await deleteTestOrgByDomain(domain);
		}
	});

	test("tile is hidden for an org with no staffing listing", async ({
		page,
	}) => {
		const { email, domain } = await createTestOrgAdminDirect(
			generateTestOrgEmail("agref-tile-no").email,
			TEST_PASSWORD
		);
		try {
			await orgLogin(page, domain, email, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/`);

			// Wait for the dashboard to actually render before asserting absence.
			await expect(page.locator("text=Org Dashboard")).toBeVisible({
				timeout: 10000,
			});
			// Give the provider-detection fetch time to resolve; the tile must not appear.
			await page.waitForLoadState("networkidle");
			await expect(page.locator(`text=${TILE_TEXT}`)).toHaveCount(0);
		} finally {
			await deleteTestOrgByDomain(domain);
		}
	});

	test("tile is hidden for an org whose only staffing listing is a draft", async ({
		page,
	}) => {
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("agref-tile-draft").email,
			TEST_PASSWORD
		);
		try {
			// A draft staffing listing does not make the org a registered provider —
			// no consumer can subscribe/assign it, so the tile stays hidden.
			await createTestMarketplaceListingDirect(
				orgId,
				domain,
				["staffing"],
				"draft",
				"Draft Staffing Listing"
			);

			await orgLogin(page, domain, email, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/`);

			await expect(page.locator("text=Org Dashboard")).toBeVisible({
				timeout: 10000,
			});
			await page.waitForLoadState("networkidle");
			await expect(page.locator(`text=${TILE_TEXT}`)).toHaveCount(0);
		} finally {
			await deleteTestOrgByDomain(domain);
		}
	});
});
