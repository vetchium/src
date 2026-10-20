import type { Page } from "@playwright/test";

/**
 * Answers the Applications list the shell reads for its navigation badge.
 * Specs that run a stored fake session against mocked account routes call it
 * so the real API is not asked about a token it never issued.
 */
export async function stubNoApplications(page: Page): Promise<void> {
  await page.route("**/api/hub/list-my-applications", (route) =>
    route.fulfill({ json: { applications: [] } }),
  );
}
