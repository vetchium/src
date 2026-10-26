import type { Page } from "@playwright/test";

/**
 * Answers the Applications and Conversations lists the shell reads for its
 * navigation badges. Specs that run a stored fake session against mocked account
 * routes call it so the real API is not asked about a token it never issued.
 */
export async function stubNoApplications(page: Page): Promise<void> {
  await page.route("**/api/hub/list-my-applications", (route) =>
    route.fulfill({ json: { applications: [] } }),
  );
  await page.route("**/api/hub/list-conversations", (route) =>
    route.fulfill({ json: { items: [], next_cursor: null } }),
  );
}
