import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnTo } from "./navigation.ts";

test("only a path on this origin is a return destination", () => {
  assert.equal(safeReturnTo("/u/someone?tab=1"), "/u/someone?tab=1");
  for (const value of [
    null,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\\/evil.example",
    "javascript:alert(1)",
  ]) {
    assert.equal(safeReturnTo(value), "/", String(value));
  }
});
