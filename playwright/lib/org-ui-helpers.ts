import { Page, expect } from "@playwright/test";
import { getTfaCodeFromEmail } from "./mailpit";

export const ORG_UI_URL = "http://localhost:3002";

/**
 * Logs in to the Org UI and completes TFA.
 */
export async function orgLogin(
	page: Page,
	domain: string,
	email: string,
	password: string
) {
	await page.goto(`${ORG_UI_URL}/login`);
	await page.fill(
		'input[placeholder="Company Domain (e.g., acme.com)"]',
		domain
	);
	await page.fill('input[placeholder="Email"]', email);
	await page.fill('input[placeholder="Password"]', password);
	await page.click('button:has-text("Login")');

	// Wait for TFA page
	await expect(page).toHaveURL(`${ORG_UI_URL}/tfa`);

	// Get TFA code
	const tfaCode = await getTfaCodeFromEmail(email);

	// Fill and verify
	await page.fill('input[placeholder="Enter 6-digit code"]', tfaCode);
	await page.click('button:has-text("Verify")');

	// Confirm dashboard
	await expect(page).toHaveURL(`${ORG_UI_URL}/`);
	await expect(page.locator("text=Org Dashboard")).toBeVisible();
}

/**
 * Navigates to the addresses page.
 */
export async function gotoAddresses(page: Page) {
	await page.goto(`${ORG_UI_URL}/settings/addresses`);
	await expect(page.locator('h2:has-text("Company Addresses")')).toBeVisible();
}

/**
 * Adds a new address via the UI.
 */
export async function addAddress(
	page: Page,
	data: {
		title: string;
		addressLine1: string;
		city: string;
		country: string;
		addressLine2?: string;
		state?: string;
		postalCode?: string;
	}
) {
	await page.click('button:has-text("Add Address")');
	const modal = page.getByRole("dialog", { name: "Add Address" });
	await expect(modal).toBeVisible();
	await modal.getByLabel("Title").fill(data.title);
	await modal.getByLabel("Address Line 1").fill(data.addressLine1);
	if (data.addressLine2) {
		await modal.getByLabel("Address Line 2").fill(data.addressLine2);
	}
	await modal.getByLabel("City").fill(data.city);
	if (data.state) {
		await modal.getByLabel("State / Province").fill(data.state);
	}
	if (data.postalCode) {
		await modal.getByLabel("Postal Code").fill(data.postalCode);
	}
	await modal.getByLabel("Country").fill(data.country);
	await page.click('button:has-text("Save Address")');
}
