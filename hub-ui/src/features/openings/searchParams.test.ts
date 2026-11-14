import assert from "node:assert/strict";
import test from "node:test";
import {
  paramsFromSearchState,
  searchStateFromParams,
} from "./searchParams.ts";

const isRegion = (tenantId: string) => ["sgp", "usa1"].includes(tenantId);

test("every filter round-trips through the URL in the listed order", () => {
  const query =
    "q=engineer&region=usa1&org=example.com&tag=golang&tag=python" +
    "&country=SG&country=IN&arrangement=remote&employment=full_time" +
    "&posted=7&experience=4&education=master&salary=1";
  const state = searchStateFromParams(new URLSearchParams(query), isRegion);
  assert.deepEqual(state, {
    region: "usa1",
    filters: {
      keyword: "engineer",
      org_domain: "example.com",
      tag_oids: ["golang", "python"],
      work_countries: ["SG", "IN"],
      work_arrangements: ["remote"],
      employment_types: ["full_time"],
      posted_within_days: 7,
      experience_years: 4,
      education_level: "master",
      salary_disclosed: true,
    },
  });
  assert.equal(paramsFromSearchState(state).toString(), query);
});

test("hand-edited values the API would refuse are dropped", () => {
  const state = searchStateFromParams(
    new URLSearchParams(
      "q=a&region=gone&org=not a domain&tag=golang&tag=Bad_Tag&tag=golang" +
        "&country=sg&country=XX&arrangement=office&employment=full_time" +
        "&posted=3&experience=4.5&education=phd&salary=yes",
    ),
    isRegion,
  );
  assert.deepEqual(state, {
    filters: {
      tag_oids: ["golang"],
      work_countries: ["SG"],
      employment_types: ["full_time"],
    },
  });
});

test("a list over its limit is dropped whole", () => {
  const tags = ["a1", "a2", "a3", "a4", "a5", "a6"]
    .map((tag) => `tag=${tag}`)
    .join("&");
  const state = searchStateFromParams(new URLSearchParams(tags), isRegion);
  assert.deepEqual(state, { filters: {} });
});

test("a repeated region is ignored", () => {
  const state = searchStateFromParams(
    new URLSearchParams("region=usa1&region=sgp"),
    isRegion,
  );
  assert.deepEqual(state, { filters: {} });
});
