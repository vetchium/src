import type { Page } from "@playwright/test";
import { ProfileNotFoundError } from "typespec/problem/hub/profile";

/**
 * Answers what the shell reads on every page: the application and awaiting
 * conversation counts for its navigation badges, and the own profile for the
 * account menu's picture (not found, so the menu shows the initial). Specs
 * that run a stored fake session against mocked account routes call it so
 * the real API is not asked about a token it never issued; a spec's own
 * later route for a read takes precedence.
 */
export async function stubShellReads(page: Page): Promise<void> {
  await page.route("**/api/hub/my-application-counts", (route) =>
    route.fulfill({ json: { active: 0, closed: 0, awaiting_answer: 0 } }),
  );
  await page.route("**/api/hub/count-awaiting-conversations", (route) =>
    route.fulfill({ json: { requests_received: 0, unread: 0 } }),
  );
  await page.route("**/api/hub/profile/read", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/problem+json",
      json: ProfileNotFoundError,
    }),
  );
}
