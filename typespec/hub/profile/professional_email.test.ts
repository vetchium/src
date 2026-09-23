import assert from "node:assert/strict";
import { test } from "node:test";

import {
  effectiveProfessionalEmailLimit,
  normalizeAddProfessionalEmailRequest,
  validateAddProfessionalEmailRequest,
  validateListProfessionalEmailsRequest,
  validateVerifyProfessionalEmailRequest,
} from "./professional_email.ts";

test("professional email contracts keep evidence private and bounded", () => {
  assert.equal(effectiveProfessionalEmailLimit({}), 10);
  assert.deepEqual(validateListProfessionalEmailsRequest({ limit: 11 }), [
    "limit",
  ]);
  const input = { email_address: "  ALICE@EXAMPLE.COM  " };
  const normalized = normalizeAddProfessionalEmailRequest(input);
  assert.equal(normalized.email_address, "alice@example.com");
  assert.equal(input.email_address, "  ALICE@EXAMPLE.COM  ");
  assert.deepEqual(validateAddProfessionalEmailRequest(normalized), []);
  assert.deepEqual(
    validateAddProfessionalEmailRequest({ email_address: "alice@localhost" }),
    ["email_address"],
  );
  assert.deepEqual(
    validateVerifyProfessionalEmailRequest({
      id: "bad",
      challenge_id: "also-bad",
      code: "12345a",
    }),
    ["id", "challenge_id", "code"],
  );
});
