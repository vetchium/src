import { expect, test } from "@playwright/test";
import { credentialRefreshPruneRace } from "../lib/admin-db.ts";

test("housekeeping skips credentials being atomically refreshed", async () => {
  const result = await credentialRefreshPruneRace();
  expect(result).toEqual({
    freshIdempotencyRows: 1,
    freshPasswordResets: 1,
    prunedIdempotencyRows: 0,
    prunedPasswordResets: 0,
  });
});
