import { expect, test } from "@playwright/test";
import { legacySessionUpgradeAuthenticationTimes } from "../lib/admin-db.ts";

test("Admin API migration preserves legacy session authentication age", () => {
  const times = legacySessionUpgradeAuthenticationTimes();
  expect(times.authenticatedAt).toBe(times.createdAt);
  expect(times.authenticatedAt).toBeLessThan(Date.now() - 5 * 60_000);
});
