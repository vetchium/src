import assert from "node:assert/strict";
import { test } from "node:test";

import { isProfessionalDomain, normalizeProfessionalDomain } from "./domain.ts";

test("professional domains normalize and reject non-domain input", () => {
  assert.equal(normalizeProfessionalDomain("  EXAMPLE.COM. "), "example.com");
  for (const value of ["example.com", "xn--bcher-kva.example", "foo.123"]) {
    assert.equal(isProfessionalDomain(value), true, value);
  }
  for (const value of [
    "",
    "example",
    "-foo.example",
    "foo-.example",
    "foo..example",
    "*.example",
    "foo@example.com",
    "https://example.com",
    "foo:80.example",
    "bücher.example",
    "127.0.0.1",
    "[::1]",
    "foo.example..",
  ]) {
    assert.equal(isProfessionalDomain(value), false, value);
  }
});
