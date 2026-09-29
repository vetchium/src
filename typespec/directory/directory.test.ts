import assert from "node:assert/strict";
import test from "node:test";
import {
  isDigestKeyID,
  isEmailDigest,
  isHubAlias,
  isProfileSlug,
  isTenantID,
} from "./directory.ts";

test("directory identifiers enforce disjoint handle and alias syntax", () => {
  assert.equal(isHubAlias("mary-jane"), true);
  assert.equal(isHubAlias("api"), false);
  assert.equal(isHubAlias("abcde000-0123456789a"), false);
  assert.equal(isProfileSlug("abcde000-0123456789a"), true);
  assert.equal(isTenantID("ind1"), true);
  assert.equal(isTenantID("IN"), false);
});

test("email digest and digest key id are fixed-length lowercase hex", () => {
  const digest =
    "bee57e69a23d800d7718d0e79b2be1519e131232967431dba85e2737b6621f6e";
  assert.equal(isEmailDigest(digest), true);
  assert.equal(isEmailDigest(digest.toUpperCase()), false);
  assert.equal(isEmailDigest(digest.slice(0, -1)), false);
  assert.equal(isEmailDigest("not-hex"), false);

  const keyID = "909577e87ebd5395";
  assert.equal(isDigestKeyID(keyID), true);
  assert.equal(isDigestKeyID(keyID.toUpperCase()), false);
  assert.equal(isDigestKeyID("short"), false);
});
