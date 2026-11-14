import assert from "node:assert/strict";
import test from "node:test";
import { isOpeningTagOID } from "./opening_tags.ts";

test("isOpeningTagOID accepts catalog OIDs", () => {
  for (const value of ["go", "c-plus-plus", "a".repeat(64)]) {
    assert.equal(isOpeningTagOID(value), true, value);
  }
});

test("isOpeningTagOID refuses malformed OIDs", () => {
  for (const value of [
    "a",
    "a".repeat(65),
    "Go",
    "-go",
    "go-",
    "go--lang",
    "go_lang",
    "c#",
  ]) {
    assert.equal(isOpeningTagOID(value), false, value);
  }
});
