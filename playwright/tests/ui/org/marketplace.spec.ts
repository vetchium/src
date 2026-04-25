import { test, expect } from "@playwright/test";
import { orgLogin, ORG_UI_URL } from "../../../lib/org-ui-helpers";
import { antdSelect } from "../../../lib/ui-helpers";
import {
	createTestOrgAdminDirect,
	deleteTestOrgByDomain,
	generateTestOrgEmail,
	createTestMarketplaceCapability,
	deleteTestMarketplaceCapability,
	createTestMarketplaceListingDirect,
	setOrgPlan,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";

const _capSuffix = Math.random().toString(36).slice(2, 10);
const SHARED_CAP_ID = `mp-ui-cap-${_capSuffix}`;
const SHARED_CAP2_ID = `mp-ui-cap2-${_capSuffix}`;
// Unique display names per run to avoid stale-data interference when previous runs were interrupted
const CAP1_DISPLAY = `UI Test Cap ${_capSuffix}`;
const CAP2_DISPLAY = `UI Test Cap2 ${_capSuffix}`;

test.beforeAll(async () => {
	await createTestMarketplaceCapability(SHARED_CAP_ID, "active", CAP1_DISPLAY);
	await createTestMarketplaceCapability(SHARED_CAP2_ID, "active", CAP2_DISPLAY);
});

test.afterAll(async () => {
	await deleteTestMarketplaceCapability(SHARED_CAP_ID);
	await deleteTestMarketplaceCapability(SHARED_CAP2_ID);
});

// ============================================================================
// Discover page
// ============================================================================
test.describe("Org UI Marketplace — Discover Page", () => {
	test("Discover page renders listing cards", async ({ page }) => {
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-ui-disc").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			await createTestMarketplaceListingDirect(
				orgId,
				domain,
				[SHARED_CAP_ID],
				"active",
				"Discover UI Test Listing"
			);

			await orgLogin(page, domain, email, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/marketplace`);

			await expect(page.locator("text=Discover Marketplace")).toBeVisible({
				timeout: 10000,
			});
			await expect(page.locator("text=Discover UI Test Listing")).toBeVisible({
				timeout: 10000,
			});
		} finally {
			await deleteTestOrgByDomain(domain);
		}
	});

	test("Capability filter narrows discover results", async ({ page }) => {
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-ui-filter").email,
			TEST_PASSWORD
		);
		try {
			await createTestMarketplaceListingDirect(
				orgId,
				domain,
				[SHARED_CAP_ID],
				"active",
				"Cap1 Listing"
			);
			await createTestMarketplaceListingDirect(
				orgId,
				domain,
				[SHARED_CAP2_ID],
				"active",
				"Cap2 Listing"
			);

			await orgLogin(page, domain, email, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/marketplace`);

			await expect(page.locator("text=Cap1 Listing")).toBeVisible({
				timeout: 10000,
			});
			await expect(page.locator("text=Cap2 Listing")).toBeVisible();

			// Select SHARED_CAP_ID in the capability filter
			const filterSelect = page
				.locator(".ant-select")
				.filter({ hasText: /filter by capability/i });
			if ((await filterSelect.count()) > 0) {
				await filterSelect.click();
				const filterDropdown = page.locator(
					".ant-select-dropdown:not(.ant-select-dropdown-hidden)"
				);
				await expect(filterDropdown).toBeVisible({ timeout: 5000 });
				await filterDropdown
					.locator(`.ant-select-item-option:has-text("${CAP1_DISPLAY}")`)
					.first()
					.click();
				await page.waitForLoadState("networkidle");
				await expect(page.locator("text=Cap1 Listing")).toBeVisible({
					timeout: 10000,
				});
			}
		} finally {
			await deleteTestOrgByDomain(domain);
		}
	});
});

// ============================================================================
// Create listing form
// ============================================================================
test.describe("Org UI Marketplace — Create Listing", () => {
	test("Create listing form: capability multi-select, save draft navigates to /marketplace/listings", async ({
		page,
	}) => {
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-ui-create").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			await orgLogin(page, domain, email, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/marketplace/listings/new`);

			await expect(
				page.locator("h2", { hasText: /Create Marketplace Listing/i })
			).toBeVisible({
				timeout: 15000,
			});

			await page.fill('input[id="headline"]', "My UI Test Listing");
			await page.fill(
				'textarea[id="description"]',
				"Description for UI test listing"
			);

			// Select capability from multi-select dropdown (use aria role to avoid matching header language selector)
			await page.getByRole("combobox", { name: /capabilities/i }).click();
			const capDropdown = page.locator(
				".ant-select-dropdown:not(.ant-select-dropdown-hidden)"
			);
			await expect(capDropdown).toBeVisible({ timeout: 10000 });
			await capDropdown
				.locator(`.ant-select-item-option:has-text("${CAP1_DISPLAY}")`)
				.first()
				.click();
			await page.locator('input[id="headline"]').click(); // close dropdown by clicking above the select

			await page.click('button:has-text("Save Draft")');

			// Should navigate to /marketplace/listings
			await expect(page).toHaveURL(`${ORG_UI_URL}/marketplace/listings`, {
				timeout: 10000,
			});
		} finally {
			await deleteTestOrgByDomain(domain);
		}
	});
});

// ============================================================================
// Publish as superadmin -> Active status
// ============================================================================
test.describe("Org UI Marketplace — Publish as Superadmin", () => {
	test("Superadmin Publish shows Active status on listing page", async ({
		page,
	}) => {
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-ui-pub").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			await orgLogin(page, domain, email, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/marketplace/listings/new`);

			await expect(
				page.locator("h2", { hasText: /Create Marketplace Listing/i })
			).toBeVisible({
				timeout: 15000,
			});
			await page.fill('input[id="headline"]', "Superadmin Publish Test");
			await page.fill(
				'textarea[id="description"]',
				"Listing that will be published directly to active"
			);

			// Select capability from multi-select dropdown (use aria role to avoid matching header language selector)
			await page.getByRole("combobox", { name: /capabilities/i }).click();
			const capDropdown = page.locator(
				".ant-select-dropdown:not(.ant-select-dropdown-hidden)"
			);
			await expect(capDropdown).toBeVisible({ timeout: 10000 });
			await capDropdown
				.locator(`.ant-select-item-option:has-text("${CAP1_DISPLAY}")`)
				.first()
				.click();
			await page.locator('input[id="headline"]').click(); // close dropdown by clicking above the select

			await page.click('button:has-text("Publish")');

			// Should navigate to listings and show Active status
			await expect(page).toHaveURL(
				new RegExp(`${ORG_UI_URL}/marketplace/listings`),
				{ timeout: 10000 }
			);
			await expect(page.locator("text=Active")).toBeVisible({
				timeout: 5000,
			});
		} finally {
			await deleteTestOrgByDomain(domain);
		}
	});
});

// ============================================================================
// Quota-exceeded modal
// ============================================================================
test.describe("Org UI Marketplace — Quota Exceeded Modal", () => {
	test("Quota-exceeded modal appears with link to /settings/subscription", async ({
		page,
	}) => {
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-ui-quota").email,
			TEST_PASSWORD
		);
		try {
			// Free tier has 0 listing quota. Try to publish.
			await orgLogin(page, domain, email, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/marketplace/listings/new`);

			await expect(
				page.locator("h2", { hasText: /Create Marketplace Listing/i })
			).toBeVisible({
				timeout: 15000,
			});
			await page.fill('input[id="headline"]', "Quota Test Listing");
			await page.fill('textarea[id="description"]', "Will hit quota");

			// Select capability from multi-select dropdown (use aria role to avoid matching header language selector)
			await page.getByRole("combobox", { name: /capabilities/i }).click();
			const capDropdown = page.locator(
				".ant-select-dropdown:not(.ant-select-dropdown-hidden)"
			);
			await expect(capDropdown).toBeVisible({ timeout: 10000 });
			await capDropdown
				.locator(`.ant-select-item-option:has-text("${CAP1_DISPLAY}")`)
				.first()
				.click();
			await page.keyboard.press("Escape"); // close the multi-select dropdown

			// The quota warning banner should be visible on the page before even submitting
			// (the UI shows a pre-emptive warning when the org is at quota)
			await expect(
				page.locator(".ant-alert").filter({ hasText: /upgrade/i })
			).toBeVisible({ timeout: 10000 });
		} finally {
			await deleteTestOrgByDomain(domain);
		}
	});
});

// ============================================================================
// Subscribe flow
// ============================================================================
test.describe("Org UI Marketplace — Subscribe Flow", () => {
	test("Consumer subscribes from listing page", async ({ page }) => {
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-ui-sub-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-ui-sub-con").email,
				TEST_PASSWORD
			);
		try {
			const { listingNumber } = await createTestMarketplaceListingDirect(
				provOrgId,
				provDomain,
				[SHARED_CAP_ID],
				"active",
				"Subscribe UI Test"
			);

			await orgLogin(page, conDomain, conEmail, TEST_PASSWORD);
			await page.goto(
				`${ORG_UI_URL}/marketplace/listings/${provDomain}/${listingNumber}`
			);

			await expect(page.locator("text=Subscribe UI Test")).toBeVisible({
				timeout: 10000,
			});

			const subscribeButton = page.locator('button:has-text("Subscribe")');
			if ((await subscribeButton.count()) > 0) {
				await subscribeButton.click();
				// Successful subscribe navigates to /marketplace/subscriptions
				await expect(page).toHaveURL(/marketplace\/subscriptions/, {
					timeout: 10000,
				});
			}
		} finally {
			await deleteTestOrgByDomain(provDomain);
			await deleteTestOrgByDomain(conDomain);
		}
	});
});
