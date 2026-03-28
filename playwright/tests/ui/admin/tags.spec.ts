import { test, expect } from "@playwright/test";
import { adminLogin, ADMIN_UI_URL } from "../../../lib/admin-ui-helpers";
import { randomUUID } from "crypto";
import { deleteTestTag, createTestSuperadmin, deleteTestAdminUser } from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";

test.describe("Admin UI - Manage Tags", () => {
    let tagId: string;
    let testAdminEmail: string;

    test.beforeEach(async ({ page }) => {
        testAdminEmail = `admin-tags-ui-${randomUUID().substring(0, 8)}@test.vetchium.com`;
        await createTestSuperadmin(testAdminEmail, TEST_PASSWORD);
        tagId = `test-tag-${randomUUID().substring(0, 8)}`;
        await adminLogin(page, testAdminEmail, TEST_PASSWORD);
    });

    test.afterEach(async () => {
        if (tagId) {
            await deleteTestTag(tagId).catch(() => {});
        }
        if (testAdminEmail) {
            await deleteTestAdminUser(testAdminEmail).catch(() => {});
        }
    });

    test("should create and search for a tag", async ({ page }) => {
        // Navigate to Manage Tags
        await page.click('text=Manage Tags');
        await expect(page).toHaveURL(`${ADMIN_UI_URL}/manage-tags`);

        // Click Add Tag
        await page.click('button:has-text("Add Tag")');

        // Wait for modal
        const modal = page.locator('.ant-modal').filter({ hasText: "Add Tag" });
        await expect(modal).toBeVisible();

        // Fill Add Tag Modal
        await modal.locator('input[placeholder="e.g. artificial-intelligence"]').fill(tagId);
        
        // Fill first translation (en-US)
        await modal.getByLabel('Display Name').first().fill("Test Tag UI Name");
        await modal.getByLabel('Description').first().fill("Test Tag UI Description");

        // Submit
        await page.click('.ant-modal-footer button:has-text("Save")');

        // Verify success
        await expect(page.locator(".ant-message-success").filter({ hasText: "Tag created successfully" })).toBeVisible();

        // Search for tag
        await page.fill('input[placeholder="Search tags..."]', tagId);
        await page.keyboard.press("Enter");
        
        // Wait for API
        await page.waitForResponse(resp => resp.url().includes('/admin/filter-tags') && resp.status() === 200);

        // Verify it appears in the table
        await expect(page.locator('tbody tr').filter({ hasText: tagId })).toBeVisible();
        await expect(page.locator('tbody tr').filter({ hasText: "Test Tag UI Name" })).toBeVisible();
    });
});
