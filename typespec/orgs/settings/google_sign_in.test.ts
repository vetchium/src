import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type SetGoogleSignInRequest,
  validateSetGoogleSignInRequest,
} from "./google_sign_in.ts";

test("Google sign-in requires an explicit boolean, including false", () => {
  for (const [body, expected] of [
    ["{}", ["enabled"]],
    ['{"enabled":null}', ["enabled"]],
    ['{"enabled":true}', []],
    ['{"enabled":false}', []],
  ] as const) {
    const request = JSON.parse(body) as SetGoogleSignInRequest;
    assert.deepEqual(validateSetGoogleSignInRequest(request), [...expected]);
  }
});
