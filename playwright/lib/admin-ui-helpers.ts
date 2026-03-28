import { Page, expect } from "@playwright/test";
import { getTfaCodeFromEmail } from "./mailpit";

export const ADMIN_UI_URL = "http://localhost:3001";
export const DEFAULT_ADMIN_EMAIL = "admin1@vetchium.com";
export const DEFAULT_ADMIN_PASSWORD = "Password123$";

/**
 * Logs in to the Admin UI and completes TFA.
 */
export async function adminLogin(page: Page, email: string = DEFAULT_ADMIN_EMAIL, password: string = DEFAULT_ADMIN_PASSWORD) {
    await page.goto(`${ADMIN_UI_URL}/login`);
    await page.fill('input[placeholder="Email"]', email);
    await page.fill('input[placeholder="Password"]', password);
    await page.click('button:has-text("Login")');

    // Wait for TFA page
    await expect(page).toHaveURL(`${ADMIN_UI_URL}/tfa`);
    
    // Get TFA code
    const tfaCode = await getTfaCodeFromEmail(email);
    
    // Fill and verify
    await page.fill('input[placeholder="Enter 6-digit code"]', tfaCode);
    await page.click('button:has-text("Verify")');

    // Confirm dashboard
    await expect(page).toHaveURL(`${ADMIN_UI_URL}/`);
    await expect(page.locator("text=Admin Dashboard")).toBeVisible();
}
