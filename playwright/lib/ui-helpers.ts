import { Page, expect, Locator } from "@playwright/test";

/**
 * Common helpers for interacting with Ant Design components in Playwright.
 */

/**
 * Selects an option from an Ant Design Select component.
 * @param page The Playwright Page object.
 * @param selector The selector for the Ant Design Select (e.g., id or data-test-id).
 * @param optionText The text of the option to select.
 * @param searchText Optional text to type into the select to filter options.
 */
export async function antdSelect(
	page: Page,
	selector: string,
	optionText: string,
	searchText?: string
) {
	await page.click(selector);

	if (searchText) {
		await page.keyboard.type(searchText);
		await page.waitForTimeout(500);
	}

	// Wait for dropdown to be visible
	const dropdown = page.locator(
		".ant-select-dropdown:not(.ant-select-dropdown-hidden)"
	);
	await expect(dropdown).toBeVisible({ timeout: 10000 });

	// Find the option within the dropdown (not anywhere on the page)
	const option = dropdown
		.locator(`.ant-select-item-option:has-text("${optionText}")`)
		.first();
	await expect(option).toBeVisible({ timeout: 10000 });
	await option.click();

	// Wait for dropdown to disappear (single-select); multi-select dropdowns stay open
	await expect(dropdown)
		.not.toBeVisible({ timeout: 3000 })
		.catch(() => {});
}

/**
 * Fills an Ant Design input field.
 * @param locator The Playwright Locator for the input.
 * @param value The value to fill.
 */
export async function antdFill(locator: Locator, value: string) {
	await expect(locator).toBeVisible();
	await locator.fill(value);
}

/**
 * Clicks an Ant Design button by its text.
 * @param page The Playwright Page object.
 * @param text The text content of the button.
 */
export async function antdClickButton(page: Page, text: string) {
	const button = page.locator(`button:has-text("${text}")`);
	await expect(button).toBeVisible();
	await expect(button).toBeEnabled();
	await button.click();
}

/**
 * Waits for an Ant Design notification/message to appear and confirms its type.
 * @param page The Playwright Page object.
 * @param type The type of message ('success', 'error', 'info', 'warning').
 * @param text Optional text to verify within the message.
 */
export async function waitForAntdMessage(
	page: Page,
	type: "success" | "error" | "info" | "warning",
	text?: string
) {
	const selector = `.ant-message-${type}`;
	const message = page.locator(selector);
	await expect(message).toBeVisible({ timeout: 10000 });
	if (text) {
		await expect(message).toContainText(text);
	}
}

/**
 * Waits for an Ant Design modal to appear.
 * @param page The Playwright Page object.
 * @param title The title of the modal.
 */
export async function waitForAntdModal(page: Page, title: string) {
	const modal = page.locator(`.ant-modal:has-text("${title}")`);
	await expect(modal).toBeVisible();
	return modal;
}
