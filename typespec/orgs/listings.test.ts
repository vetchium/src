import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRelayGetListingRequest,
  validatePeerSearchListingsRequest,
  validateRelayGetListingRequest,
  validateRelaySearchListingsRequest,
} from "./marketplace/federation.ts";
import type { ListingContent } from "./marketplace/listings.ts";
import {
  isListingState,
  normalizeCreateListingRequest,
  validateCreateListingRequest,
  validateGetListingRequest,
  validateListingTarget,
  validateSearchListingsRequest,
  validateUpdateListingRequest,
} from "./marketplace/listings.ts";

const content: ListingContent = {
  headline: "Structured interviews",
  description: "We interview.",
  service: { worldwide: false, countries: ["IN", "SG"] },
  languages: ["en"],
};
const background: ListingContent = {
  ...content,
  check_types: ["identity", "education"],
  consent_disclosure: "We verify what you tell us.",
};
const text = (length: number) => "é".repeat(length);

test("listing normalization leaves the caller's values intact", () => {
  const request = {
    capability: "interviewing" as const,
    ...content,
    headline: " H ",
    service: { worldwide: false, countries: [" in "] },
    indicative_price: " 100 ",
  };
  const normalized = normalizeCreateListingRequest(request);
  assert.equal(normalized.headline, "H");
  assert.deepEqual(normalized.service.countries, ["IN"]);
  assert.equal(normalized.indicative_price, "100");
  assert.equal(request.headline, " H ");
  assert.deepEqual(request.service.countries, [" in "]);
});

test("listing content validates every rule", () => {
  const create = (edit: Partial<ListingContent>, capability = "sourcing") =>
    validateCreateListingRequest({
      capability: capability as "sourcing",
      ...content,
      ...edit,
    });
  assert.deepEqual(create({}), []);
  assert.deepEqual(create({ headline: text(200) }), []);
  assert.deepEqual(create({ headline: text(201) }), ["headline"]);
  assert.deepEqual(create({ description: "" }), ["description"]);
  assert.deepEqual(create({ description: text(10001) }), ["description"]);
  assert.deepEqual(create({ service: { worldwide: true, countries: [] } }), []);
  assert.deepEqual(
    create({ service: { worldwide: true, countries: ["IN"] } }),
    ["service.countries"],
  );
  assert.deepEqual(create({ service: { worldwide: false, countries: [] } }), [
    "service.countries",
  ]);
  assert.deepEqual(
    create({ service: { worldwide: false, countries: ["IN", "IN"] } }),
    ["service.countries"],
  );
  assert.deepEqual(create({ headline: "a\u0000b" }), ["headline"]);
  assert.deepEqual(create({ description: "a\u0000b" }), ["description"]);
  assert.deepEqual(create({ indicative_price: "a\u0000" }), [
    "indicative_price",
  ]);
  assert.deepEqual(create({ languages: ["xx-nope"] }), ["languages"]);
  assert.deepEqual(create({ indicative_price: text(501) }), [
    "indicative_price",
  ]);
  assert.deepEqual(create({ check_types: ["identity"] }, "interviewing"), [
    "check_types",
  ]);
  assert.deepEqual(create({ consent_disclosure: "x" }, "assessment"), [
    "consent_disclosure",
  ]);
  assert.deepEqual(create(background, "background_check"), []);
  assert.deepEqual(create({}, "background_check"), [
    "check_types",
    "consent_disclosure",
  ]);
  assert.deepEqual(
    create(
      { ...background, check_types: ["identity", "identity"] },
      "background_check",
    ),
    ["check_types"],
  );
  assert.deepEqual(
    create(
      { ...background, consent_disclosure: text(5001) },
      "background_check",
    ),
    ["consent_disclosure"],
  );
  assert.deepEqual(
    validateCreateListingRequest({
      capability: "plumbing" as never,
      ...content,
    }),
    ["capability"],
  );
});

test("listing updates and targets need a capability and a version", () => {
  assert.deepEqual(
    validateUpdateListingRequest({
      capability: "sourcing",
      version: 0,
      ...content,
    }),
    ["version"],
  );
  assert.deepEqual(
    validateUpdateListingRequest({
      capability: "sourcing",
      version: 1,
      ...content,
    }),
    [],
  );
  assert.deepEqual(
    validateListingTarget({ capability: "x" as never, version: -1 }),
    ["capability", "version"],
  );
  assert.equal(isListingState("listed"), true);
  assert.equal(isListingState("hidden"), false);
});

test("search requests validate filters, query length, and page size", () => {
  const search = (extra: object, capability = "sourcing") =>
    validateSearchListingsRequest({
      capability: capability as "sourcing",
      ...extra,
    });
  assert.deepEqual(search({}), []);
  assert.deepEqual(
    search({ country: "IN", language: "en", query: "ab", limit: 50 }),
    [],
  );
  assert.deepEqual(search({ country: "in" }), ["country"]);
  assert.deepEqual(search({ query: "a" }), ["query"]);
  assert.deepEqual(search({ query: "a\u0000b" }), ["query"]);
  assert.deepEqual(search({ limit: 0 }), ["limit"]);
  assert.deepEqual(search({ limit: 51 }), ["limit"]);
  assert.deepEqual(
    search({ check_types: ["criminal"] }, "background_check"),
    [],
  );
  assert.deepEqual(search({ check_types: ["criminal"] }, "interviewing"), [
    "check_types",
  ]);
  assert.deepEqual(search({ check_types: [] }, "background_check"), [
    "check_types",
  ]);
});

test("get requests validate the domain and capability", () => {
  assert.deepEqual(
    validateGetListingRequest({ domain: "acme.test", capability: "sourcing" }),
    [],
  );
  assert.deepEqual(
    validateGetListingRequest({ domain: "x", capability: "y" as never }),
    ["domain", "capability"],
  );
});

test("mesh requests prefix nested fields and normalize domains", () => {
  assert.deepEqual(
    validatePeerSearchListingsRequest({ capability: "sourcing", limit: 0 }),
    ["limit"],
  );
  assert.deepEqual(
    validatePeerSearchListingsRequest({
      capability: "sourcing",
      limit: 1,
      after: { sort_name: "", domain: "x" },
    }),
    ["after.sort_name", "after.domain"],
  );
  assert.deepEqual(
    validatePeerSearchListingsRequest({
      capability: "sourcing",
      limit: 1,
      after: { sort_name: "a\u0000", domain: "acme.test" },
    }),
    ["after.sort_name"],
  );
  assert.deepEqual(
    validateRelaySearchListingsRequest({
      tenant: "Bad",
      search: { capability: "x" as never, limit: 0 },
    }),
    ["tenant", "search.capability", "search.limit"],
  );
  const get = {
    tenant: "sgp",
    listing: { domain: " ACME.test ", capability: "sourcing" as const },
  };
  assert.deepEqual(validateRelayGetListingRequest(get), ["listing.domain"]);
  const normalized = normalizeRelayGetListingRequest(get);
  assert.equal(normalized.listing.domain, "acme.test");
  assert.deepEqual(validateRelayGetListingRequest(normalized), []);
  assert.equal(get.listing.domain, " ACME.test ");
});
