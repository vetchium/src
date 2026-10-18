import assert from "node:assert/strict";
import test from "node:test";
import {
  isDigestKeyID,
  isEmailDigest,
  isHubAlias,
  isProfileSlug,
  isTenantID,
  validateResolvePrincipalRequest,
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

test("principal resolution requires a known type and a UUIDv7 DID", () => {
  const did = "018f7e32-7b5a-7d31-8fd0-f7e2a852f144";
  assert.deepEqual(
    validateResolvePrincipalRequest({
      principal_type: "hub_user",
      principal_did: did,
    }),
    [],
  );
  assert.deepEqual(
    validateResolvePrincipalRequest({
      principal_type: "org",
      principal_did: did,
    }),
    [],
  );
  assert.deepEqual(
    validateResolvePrincipalRequest({
      principal_type: "admin" as "org",
      principal_did: did,
    }),
    ["principal_type"],
  );
  assert.deepEqual(
    validateResolvePrincipalRequest({
      principal_type: "org",
      principal_did: "f4847331-5a4f-4eae-a5f4-cc131b0cd270",
    }),
    ["principal_did"],
  );
});
