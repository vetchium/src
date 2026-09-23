import assert from "node:assert/strict";
import test from "node:test";
import { isHubAlias, isProfileSlug, isTenantID } from "./directory.ts";

test("directory identifiers enforce disjoint handle and alias syntax", () => {
  assert.equal(isHubAlias("mary-jane"), true);
  assert.equal(isHubAlias("api"), false);
  assert.equal(isHubAlias("abcde-0123456789a"), false);
  assert.equal(isProfileSlug("abcde-0123456789a"), true);
  assert.equal(isTenantID("ind1"), true);
  assert.equal(isTenantID("IN"), false);
});
