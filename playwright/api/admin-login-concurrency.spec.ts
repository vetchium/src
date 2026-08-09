import { expect, test } from "@playwright/test";
import { stalePasswordLoginCreationRace } from "../lib/admin-db.ts";

test("stale password verification cannot mint a session or TOTP challenge", async () => {
  await expect(stalePasswordLoginCreationRace()).resolves.toEqual({
    challengesCreated: 0,
    sessionsCreated: 0,
  });
});
