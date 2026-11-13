import assert from "node:assert/strict";
import test from "node:test";
import {
  compareOpeningTagNames,
  openingTagCatalog,
  openingTagMatches,
  openingTagName,
} from "./opening-tags/names.ts";

const catalog = openingTagCatalog({
  tags: [
    {
      tag_oid: "artificial-intelligence",
      display_name: "Artificial intelligence",
      localized_names: { de: "Künstliche Intelligenz", ta: "செயற்கை நுண்ணறிவு" },
      deprecated: false,
    },
    {
      tag_oid: "golang",
      display_name: "Go",
      localized_names: {},
      deprecated: false,
    },
  ],
});

test("a tag is named in the portal's base language, else by default", () => {
  const ai = "artificial-intelligence";
  assert.equal(openingTagName(catalog, ai, "ta"), "செயற்கை நுண்ணறிவு");
  assert.equal(openingTagName(catalog, ai, "de-DE"), "Künstliche Intelligenz");
  assert.equal(openingTagName(catalog, ai, "en-US"), "Artificial intelligence");
  assert.equal(openingTagName(catalog, ai, "fr-FR"), "Artificial intelligence");
  assert.equal(openingTagName(catalog, "golang", "de-DE"), "Go");
});

test("a tag the catalog lacks shows as its OID", () => {
  assert.equal(openingTagName(catalog, "no-such-tag", "en-US"), "no-such-tag");
});

test("the tag picker matches the default name, the portal name, and the OID", () => {
  const ai = catalog.get("artificial-intelligence");
  assert.ok(ai);
  assert.equal(openingTagMatches(ai, "ARTIFICIAL", "en-US"), true);
  assert.equal(openingTagMatches(ai, "künstliche", "de-DE"), true);
  assert.equal(openingTagMatches(ai, "நுண்ணறிவு", "ta"), true);
  assert.equal(openingTagMatches(ai, "-intel", "en-US"), true);
  assert.equal(openingTagMatches(ai, "künstliche", "en-US"), false);
  assert.equal(openingTagMatches(ai, "golang", "en-US"), false);
});

test("tags are ordered by the name shown in the portal language", () => {
  const order = (locale: string) =>
    [...catalog.values()]
      .sort((a, b) => compareOpeningTagNames(catalog, a, b, locale))
      .map((tag) => tag.tag_oid);
  assert.deepEqual(order("en-US"), ["artificial-intelligence", "golang"]);
  assert.deepEqual(order("de-DE"), ["golang", "artificial-intelligence"]);
});
