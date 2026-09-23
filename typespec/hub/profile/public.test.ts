import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isCredentialURL,
  isLanguageTag,
  isProfileAddress,
  isProfileMonth,
  languageCatalog,
  normalizeSaveWorkExperienceRequest,
  normalizeSetPublicFieldsRequest,
  validateSaveEducationalQualificationRequest,
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
