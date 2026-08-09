import { expect, test } from "@playwright/test";
import {
  type ReplacedAdminCredential,
  staleCredentialReplacementRace,
} from "../lib/admin-db.ts";

const credentials: ReplacedAdminCredential[] = [
  "password-reset",
  "login-challenge",
  "totp-enrollment",
];

for (const credential of credentials) {
  test(`an old ${credential} cannot consume its in-place replacement`, async () => {
    await expect(staleCredentialReplacementRace(credential)).resolves.toEqual({
      freshCredentialIntact: 1,
      oldCredentialAccepted: 0,
    });
  });
}
