import { test, expect } from "@playwright/test";
import { orgLogin, ORG_UI_URL } from "../../../lib/org-ui-helpers";
import { randomUUID } from "crypto";
import {
	createTestOrgAdminDirect,
	deleteTestOrgByDomain,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";

test.describe("Marketplace UI — provider listing and subscriber flow", () => {
	let providerDomain: string;
	let providerEmail: string;
	let consumerDomain: string;
	let consumerEmail: string;

	test.beforeAll(async () => {
		// Provider org: UUID-based .example.com domain
		const providerUUID = randomUUID();
		providerDomain = `${providerUUID}.example.com`;
		providerEmail = `admin@${providerDomain}`;

		// Consumer org: UUID-based .example.com domain
		const consumerUUID = randomUUID();
		consumerDomain = `${consumerUUID}.example.com`;
		consumerEmail = `admin@${consumerDomain}`;

		await createTestOrgAdminDirect(providerEmail, TEST_PASSWORD, "ind1");
		await createTestOrgAdminDirect(consumerEmail, TEST_PASSWORD, "ind1");
	});

	test.afterAll(async () => {
		await deleteTestOrgByDomain(providerDomain).catch(() => {});
		await deleteTestOrgByDomain(consumerDomain).catch(() => {});
	});

	test("provider creates and publishes a staffing listing; consumer subscribes; provider sees subscriber", async ({
		browser,
	}, testInfo) => {
		testInfo.setTimeout(120000);
		// ── Provider: create and publish a staffing listing ──────────────────────
		const providerContext = await browser.newContext();
		const providerPage = await providerContext.newPage();

		await orgLogin(providerPage, providerDomain, providerEmail, TEST_PASSWORD);

		// Navigate directly to create listing with staffing capability pre-selected
		// The form supports ?capability=<id> query param for pre-selection
		await providerPage.goto(
			`${ORG_UI_URL}/marketplace/listings/new?capability=staffing`
		);
		await expect(
			providerPage.locator("h2", { hasText: "Create Listing" })
		).toBeVisible();

		// Wait for capabilities to load and the staffing option to be pre-selected
		// The form pre-selects the capability from the query param once capabilities arrive
		await expect(providerPage.locator("text=staffing — Staffing")).toBeVisible({
			timeout: 15000,
		});

		// Fill headline and description
		const headline = `Staffing Service by ${providerDomain}`;
		await providerPage.fill(
			'input[placeholder="Short headline for your service (max 100 chars)"]',
			headline
		);
		await providerPage.fill(
			'textarea[placeholder="Detailed description of your service (max 10000 chars)"]',
			"We provide top-quality staffing services for technology companies. Our team of experienced recruiters specializes in placing software engineers, product managers, and data scientists."
		);

		// Click "Publish" (as superadmin → goes directly to active)
		await providerPage.click('button:has-text("Publish")');

		// Should land on the listing detail page
		await expect(providerPage).toHaveURL(
			/\/marketplace\/listings\/[0-9a-f-]{36}$/
		);
		await expect(
			providerPage.locator("h2", { hasText: headline })
		).toBeVisible();

		// Listing should be Active (two Active tags exist — one in header, one in card)
		await expect(
			providerPage.locator(".ant-tag", { hasText: "Active" }).first()
		).toBeVisible();

		// ── Consumer: discover the listing and subscribe ──────────────────────────
		const consumerContext = await browser.newContext();
		const consumerPage = await consumerContext.newPage();

		await orgLogin(consumerPage, consumerDomain, consumerEmail, TEST_PASSWORD);

		// Navigate to Marketplace discover page
		await consumerPage.goto(`${ORG_UI_URL}/marketplace/discover`);
		await expect(
			consumerPage.locator("h2", { hasText: "Marketplace" })
		).toBeVisible();

		// Find the provider's listing card
		await expect(
			consumerPage.locator(".ant-card", { hasText: headline })
		).toBeVisible({ timeout: 15000 });

		// Click on the listing card
		await consumerPage.locator(".ant-card", { hasText: headline }).click();

		// Should be on the discover detail page
		await expect(consumerPage).toHaveURL(
			/\/marketplace\/discover\/[0-9a-f-]{36}$/
		);
		await expect(
			consumerPage.locator("h2", { hasText: headline })
		).toBeVisible();

		// Click "Subscribe"
		await consumerPage.click('button:has-text("Subscribe")');

		// Confirm in the modal
		await expect(
			consumerPage.locator(".ant-modal", {
				hasText: "Confirm Subscription",
			})
		).toBeVisible();
		await consumerPage
			.locator(".ant-modal-footer button:has-text('OK')")
			.click();

		// Subscription confirmed — the subscribe button disappears and "Subscribed" tag appears
		await expect(
			consumerPage.locator(".ant-tag", { hasText: "Subscribed" })
		).toBeVisible({ timeout: 10000 });

		// ── Provider: verify the subscriber appears on the listing detail page ────
		// Reload the provider's listing detail page to refresh subscriber count
		await providerPage.reload();
		await expect(
			providerPage.locator("h2", { hasText: headline })
		).toBeVisible();

		// Scroll down to the Subscribers section
		await expect(providerPage.locator("text=Subscribers")).toBeVisible({
			timeout: 10000,
		});

		// The consumer's domain should appear in the subscribers table
		await expect(providerPage.locator("text=" + consumerDomain)).toBeVisible({
			timeout: 10000,
		});

		await providerContext.close();
		await consumerContext.close();
	});
});
