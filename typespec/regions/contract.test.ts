import assert from "node:assert/strict";
import test from "node:test";
import { validateSetPreferredJobCountriesRequest } from "../hub/users/profile.ts";
import { validateListSignupRegionsRequest } from "./regions.ts";

test("region query validates country and cursor", () => {
  assert.deepEqual(
    validateListSignupRegionsRequest({ resident_country: "IN" }),
    [],
  );
  assert.deepEqual(
    validateListSignupRegionsRequest({
      resident_country: "ZZ",
      pagination_key: "",
    }),
    ["resident_country", "pagination_key"],
  );
});
test("job countries are distinct and bounded and may be empty", () => {
  for (const preferred_job_countries of [[], ["IN"], ["FR", "GB"]])
    assert.deepEqual(
      validateSetPreferredJobCountriesRequest({ preferred_job_countries }),
      [],
    );
  for (const preferred_job_countries of [
    ["ZZ"],
    ["IND"],
    ["IN", "IN"],
    Array<string>(11).fill("IN"),
  ])
    assert.deepEqual(
      validateSetPreferredJobCountriesRequest({ preferred_job_countries }),
      ["preferred_job_countries"],
    );
});
