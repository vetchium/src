import { Page, expect } from "@playwright/test";
import { getTfaCodeFromEmail } from "./mailpit";

export const HUB_UI_URL = "http://localhost:3000";

/**
 * Logs in to the Hub UI and completes TFA.
 */
export async function hubLogin(page: Page, email: string, password: string) {
    await page.goto(`${HUB_UI_URL}/login`);
    await page.fill('input[placeholder="Email"]', email);
    await page.fill('input[placeholder="Password"]', password);
    await page.click('button:has-text("Login")');

    // Wait for TFA page
    await expect(page).toHaveURL(`${HUB_UI_URL}/tfa`);
    
    // Get TFA code
    const tfaCode = await getTfaCodeFromEmail(email);
    
    // Fill and verify
    await page.fill('input[placeholder="Enter 6-digit code"]', tfaCode);
    await page.click('button:has-text("Verify")');

    // Confirm home
    await expect(page).toHaveURL(`${HUB_UI_URL}/`);
    await expect(page.locator("text=Welcome to Vetchium Hub")).toBeVisible();
}
