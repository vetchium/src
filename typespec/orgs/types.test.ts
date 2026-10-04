import assert from "node:assert/strict";
import test from "node:test";
import {
  isOrgDomain,
  isSpecialUseDomain,
  normalizeOrgDomain,
} from "./types.ts";

test("Org domains are exact, normalized, and end in a lettered label", () => {
  assert.equal(isOrgDomain("example.com"), true);
  assert.equal(isOrgDomain("eu.example.co.uk"), true);
  assert.equal(isOrgDomain("example"), false);
  assert.equal(isOrgDomain("Example.com"), false);
  assert.equal(isOrgDomain("example.123"), false);
  assert.equal(isOrgDomain("192.168.1.1"), false);
  assert.equal(normalizeOrgDomain(" Example.COM. "), "example.com");
});

test("special-use names and their subdomains are recognized", () => {
  for (const domain of [
    "acme.test",
    "eu.acme.test",
    "acme.example",
    "example.com",
    "eu.example.org",
    "printer.local",
    "router.home.arpa",
    "acme.internal",
  ]) {
    assert.equal(isSpecialUseDomain(domain), true, domain);
  }
  for (const domain of [
    "acme.com",
    "latest.com",
    "example.co.uk",
    "myexample.com",
    "test.com",
    "arpa.example.net.au",
  ]) {
    assert.equal(isSpecialUseDomain(domain), false, domain);
  }
});
