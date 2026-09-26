import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isCredentialURL,
  isLanguageTag,
  isProfileAddress,
  isProfileMonth,
  isWebsiteURL,
  languageCatalog,
  normalizeSaveWebsiteRequest,
  normalizeSaveWorkExperienceRequest,
  normalizeSetPublicFieldsRequest,
  normalizeWebsiteURL,
  validateSaveEducationalQualificationRequest,
  validateSaveWebsiteRequest,
  validateSaveWorkExperienceRequest,
} from "./public.ts";

test("profile addressing and month boundaries", () => {
  for (const value of ["alice", "a-b", "alice-2"]) {
    assert.equal(isProfileAddress(value), true, value);
  }
  for (const value of ["ab", "-alice", "alice-", "alice--2", "Alice", "api"]) {
    assert.equal(isProfileAddress(value), false, value);
  }
  assert.equal(isProfileMonth("1900-01"), true);
  for (const value of ["1899-12", "2020-00", "2020-13", "2020-1"]) {
    assert.equal(isProfileMonth(value), false, value);
  }
});

test("language catalog accepts living CLDR languages only", () => {
  for (const tag of ["en", "ta", "ase"]) {
    assert.equal(isLanguageTag(tag), true, tag);
  }
  for (const tag of ["eo", "akk", "en-US", "en-Latn", "iw", "x-private"]) {
    assert.equal(isLanguageTag(tag), false, tag);
  }
  assert.equal(languageCatalog.length, 578);
});

test("profile normalization is pure", () => {
  const basics = { display_name: "  Alice  ", biography: "  first\nsecond  " };
  const normalizedBasics = normalizeSetPublicFieldsRequest(basics);
  assert.deepEqual(normalizedBasics, {
    display_name: "Alice",
    biography: "first\nsecond",
  });
  assert.equal(basics.biography, "  first\nsecond  ");

  const work = {
    employer_domain: "  EXAMPLE.COM. ",
    job_title: "  Engineer  ",
    start_month: "2020-01",
    location: "  London  ",
  };
  const normalizedWork = normalizeSaveWorkExperienceRequest(work);
  assert.equal(normalizedWork.employer_domain, "example.com");
  assert.equal(normalizedWork.location, "London");
  assert.equal(work.location, "  London  ");
});

test("profile fields reject malformed records and credential URLs", () => {
  assert.deepEqual(
    validateSaveWorkExperienceRequest({
      employer_domain: "not-a-domain",
      job_title: " ",
      start_month: "2020-01",
      end_month: "2019-12",
      description: "界".repeat(2001),
    }),
    ["employer_domain", "job_title", "end_month", "description"],
  );
  assert.deepEqual(
    validateSaveEducationalQualificationRequest({
      institution_domain: "example.edu",
      degree: "BSc",
      start_month: "2020-01",
      end_month: "2019-12",
    }),
    ["end_month"],
  );
  for (const value of [
    "https://user:pass@example.com/credential",
    "http://example.com/credential",
    "https://example.com/credential#fragment",
    "https://example.com/ü",
  ]) {
    assert.equal(isCredentialURL(value), false, value);
  }
  assert.equal(isCredentialURL("https://example.com/credential?id=1"), true);
});

test("website URLs normalize and validate identically to the Go companion", () => {
  // The same table is asserted by the Go companion.
  const normalizations: [string, string][] = [
    ["  HTTPS://GitHub.COM/Octocat/  ", "https://github.com/Octocat"],
    ["https://Example.com/", "https://example.com"],
    ["https://example.com/?a=1", "https://example.com/?a=1"],
    ["https://EXAMPLE.com:8443/A/b/", "https://example.com:8443/A/b"],
    ["https://example.com/a/?next=/", "https://example.com/a/?next=/"],
    ["http://Example.com/", "http://Example.com/"],
    ["not a url", "not a url"],
  ];
  for (const [input, want] of normalizations) {
    assert.equal(normalizeWebsiteURL(input), want, input);
  }
  for (const valid of [
    "https://github.com/octocat",
    "https://www.linkedin.com/in/some-person-123",
    "https://x.com/handle",
    "https://sub.example.co.uk",
    "https://example.com:8443/path?q=1&r=%C3%BC",
    "https://example.com/?a=1",
    "https://xn--mnchen-3ya.de/stra%C3%9Fe",
    "https://1.2.3.4.example.com/x",
    `https://example.com/${"a".repeat(2028)}`,
  ]) {
    assert.equal(isWebsiteURL(valid), true, valid);
  }
  for (const invalid of [
    "",
    "http://example.com",
    "https://",
    "https://localhost",
    "https://127.0.0.1",
    "https://1.2.3.4:8080/x",
    "https://Example.com",
    "https://user:pass@example.com",
    "https://example.com@evil.example.org",
    "https://example.com#fragment",
    "https://example.com/a#fragment",
    "https://example.com?x=1",
    "https://example.com/",
    "https://example.com/a b",
    "https://example.com/ü",
    "https://münchen.de",
    "https://-bad.example.com",
    "https://bad-.example.com",
    "https://example..com",
    "https://example.com:123456",
    `https://${"a".repeat(64)}.com`,
    `https://example.com/${"a".repeat(2048)}`,
  ]) {
    assert.equal(isWebsiteURL(invalid), false, invalid);
  }

  const request = { id: "not-a-uuid", url: " HTTP://Example.com/ " };
  const normalized = normalizeSaveWebsiteRequest(request);
  assert.equal(request.url, " HTTP://Example.com/ ");
  assert.equal(normalized.url, "HTTP://Example.com/");
  assert.deepEqual(validateSaveWebsiteRequest(normalized), ["id", "url"]);
  assert.deepEqual(
    validateSaveWebsiteRequest(
      normalizeSaveWebsiteRequest({ url: " https://GitHub.com/octocat/ " }),
    ),
    [],
  );
});
