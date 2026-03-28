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
