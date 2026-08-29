import { expect, test } from "../lib/admin-fixtures.ts";

// Every page needs exactly one level-1 heading naming it. Screen-reader users
// navigate by heading, and a page whose highest heading is an h2 has no
// top-level landmark to land on.
const publicRoutes = [
  "/login",
  "/login/two-factor",
  "/forgot-password",
  "/reset-password",
  "/complete-setup",
];

for (const route of publicRoutes) {
  test(`${route} exposes exactly one level-1 heading`, async ({ page }) => {
    await page.goto(route);
    const headings = page.getByRole("heading", { level: 1 });
    await expect(headings).toHaveCount(1);
    await expect(headings.first()).toBeVisible();
  });
}
