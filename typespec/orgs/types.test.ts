import assert from "node:assert/strict";
import test from "node:test";
import { isOrgDomain, normalizeOrgDomain } from "./types.ts";

test("Org domains are exact, normalized, and end in a lettered label", () => {
  assert.equal(isOrgDomain("example.com"), true);
  assert.equal(isOrgDomain("eu.example.co.uk"), true);
  assert.equal(isOrgDomain("example"), false);
  assert.equal(isOrgDomain("Example.com"), false);
  assert.equal(isOrgDomain("example.123"), false);
  assert.equal(isOrgDomain("192.168.1.1"), false);
  assert.equal(normalizeOrgDomain(" Example.COM. "), "example.com");
});
