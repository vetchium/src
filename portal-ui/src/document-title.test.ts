import assert from "node:assert/strict";
import test from "node:test";
import { prefixedTitle, unprefixedTitle } from "./document-title.ts";

test("a title count prefix is added once and removed exactly", () => {
  assert.equal(prefixedTitle("Messages", "(3) "), "(3) Messages");
  assert.equal(prefixedTitle("(3) Messages", "(3) "), "(3) Messages");
  assert.equal(unprefixedTitle("(3) Messages", "(3) "), "Messages");
  assert.equal(unprefixedTitle("Messages", "(3) "), "Messages");
  assert.equal(unprefixedTitle("(2) Messages", "(3) "), "(2) Messages");
});
