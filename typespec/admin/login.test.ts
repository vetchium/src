import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type LoginRequest,
  normalizeLoginRequest,
  validateLoginRequest,
} from "./auth/login.ts";

test("normalizeLoginRequest returns a normalized copy", () => {
  const request: LoginRequest = {
    email_address: " ADMIN@example.com ",
    password: "password",
  };

  const normalized = normalizeLoginRequest(request);

  assert.deepEqual(normalized, {
    email_address: "admin@example.com",
    password: "password",
  });
  assert.equal(request.email_address, " ADMIN@example.com ");
});

test("validateLoginRequest reports JSON field names", () => {
  assert.deepEqual(
    validateLoginRequest({
      email_address: "not-an-email",
      password: "",
    }),
    ["email_address", "password"],
  );
});

test("validateLoginRequest normalizes before validation", () => {
  assert.deepEqual(
    validateLoginRequest({
      email_address: " ADMIN@example.com ",
      password: "password",
    }),
    [],
  );
});
