import assert from "node:assert/strict";
import test from "node:test";
import {
  MaxOpeningSalary,
  missingForPublication,
  normalizeOpeningContent,
  type OpeningContent,
  validateOpeningContent,
} from "./openings.ts";

const valid = (): OpeningContent => ({
  title: "Engineer",
  description: "Build things",
  language: "en",
  employing_country: "IN",
  work_arrangement: "on_site",
  employment_type: "full_time",
  positions: 1,
});

const invalid: [string, Partial<OpeningContent>, string][] = [
  ["empty title", { title: "" }, "title"],
  ["title too long", { title: "界".repeat(201) }, "title"],
  ["empty description", { description: "" }, "description"],
  ["description too long", { description: "界".repeat(20001) }, "description"],
  ["unknown language", { language: "en-US" }, "language"],
  ["unknown country", { employing_country: "ZZ" }, "employing_country"],
  ["unknown arrangement", { work_arrangement: "virtual" }, "work_arrangement"],
  [
    "location too long",
    { location_details: "界".repeat(2001) },
    "location_details",
  ],
  [
    "remote with on site",
    { remote_eligibility: { kind: "worldwide" } },
    "remote_eligibility",
  ],
  [
    "unknown remote kind",
    { work_arrangement: "remote", remote_eligibility: { kind: "unknown" } },
    "remote_eligibility.kind",
  ],
  [
    "worldwide list",
    {
      work_arrangement: "remote",
      remote_eligibility: { kind: "worldwide", countries: [] },
    },
    "remote_eligibility.countries",
  ],
  [
    "countries empty",
    { work_arrangement: "remote", remote_eligibility: { kind: "countries" } },
    "remote_eligibility.countries",
  ],
  [
    "countries duplicate",
    {
      work_arrangement: "remote",
      remote_eligibility: { kind: "countries", countries: ["IN", "IN"] },
    },
    "remote_eligibility.countries.1",
  ],
  [
    "countries invalid",
    {
      work_arrangement: "remote",
      remote_eligibility: { kind: "countries", countries: ["IN", "ZZ"] },
    },
    "remote_eligibility.countries.1",
  ],
  [
    "employing country omitted",
    {
      work_arrangement: "remote",
      remote_eligibility: { kind: "countries", countries: ["US"] },
    },
    "remote_eligibility.countries",
  ],
  ["unknown employment", { employment_type: "gig" }, "employment_type"],
  ["positions below", { positions: 0 }, "positions"],
  ["positions above", { positions: 11 }, "positions"],
  ["positions fraction", { positions: 1.5 }, "positions"],
  [
    "experience min below",
    { experience_years: { min: -1 } },
    "experience_years.min",
  ],
  [
    "experience min above",
    { experience_years: { min: 51 } },
    "experience_years.min",
  ],
  [
    "experience max below",
    { experience_years: { max: -1 } },
    "experience_years.max",
  ],
  [
    "experience max above",
    { experience_years: { max: 51 } },
    "experience_years.max",
  ],
  [
    "experience reversed",
    { experience_years: { min: 2, max: 1 } },
    "experience_years.max",
  ],
  ["unknown education", { minimum_education: "other" }, "minimum_education"],
  [
    "currency invalid",
    { salary: { currency: "ZZZ", min: 0, max: 1, period: "year" } },
    "salary.currency",
  ],
  [
    "salary min negative",
    { salary: { currency: "USD", min: -1, max: 1, period: "year" } },
    "salary.min",
  ],
  [
    "salary reversed",
    { salary: { currency: "USD", min: 2, max: 1, period: "year" } },
    "salary.min",
  ],
  [
    "salary max zero",
    { salary: { currency: "USD", min: 0, max: 0, period: "year" } },
    "salary.max",
  ],
  [
    "salary period invalid",
    { salary: { currency: "USD", min: 0, max: 1, period: "week" } },
    "salary.period",
  ],
];

for (const [name, change, field] of invalid) {
  test(name, () =>
    assert.ok(
      validateOpeningContent({ ...valid(), ...change }).includes(field),
      field,
    ),
  );
}

test("valid boundaries and publication requirements", () => {
  const content: OpeningContent = {
    ...valid(),
    title: "界".repeat(200),
    description: "界".repeat(20000),
    location_details: "界".repeat(2000),
    positions: 10,
    experience_years: { min: 0, max: 50 },
    salary: { currency: "USD", min: 0, max: 1, period: "year" },
  };
  assert.deepEqual(missingForPublication(content), []);
  assert.deepEqual(missingForPublication({}), [
    "title",
    "description",
    "language",
    "employing_country",
    "work_arrangement",
    "employment_type",
    "positions",
  ]);
  assert.ok(
    missingForPublication({ ...valid(), work_arrangement: "remote" }).includes(
      "remote_eligibility",
    ),
  );
});

test("normalization makes a copy and keeps duplicate countries for validation", () => {
  const source: OpeningContent = {
    ...valid(),
    title: "  Engineer  ",
    description: "  text  ",
    language: " en ",
    employing_country: " in ",
    location_details: "  city  ",
    work_arrangement: "remote",
    remote_eligibility: { kind: "countries", countries: [" in ", " IN "] },
    salary: { currency: " usd ", min: 0, max: 1, period: "year" },
  };
  const normalized = normalizeOpeningContent(source);
  assert.equal(source.title, "  Engineer  ");
  assert.deepEqual(source.remote_eligibility?.countries, [" in ", " IN "]);
  assert.equal(normalized.title, "Engineer");
  assert.equal(normalized.description, "text");
  assert.equal(normalized.language, "en");
  assert.equal(normalized.employing_country, "IN");
  assert.equal(normalized.location_details, "city");
  assert.equal(normalized.salary?.currency, "USD");
  assert.deepEqual(normalized.remote_eligibility?.countries, ["IN", "IN"]);
  assert.ok(
    validateOpeningContent(normalized).includes(
      "remote_eligibility.countries.1",
    ),
  );
});

test("normalization keeps an explicitly empty worldwide country list", () => {
  const content = normalizeOpeningContent({
    ...valid(),
    work_arrangement: "remote",
    remote_eligibility: { kind: "worldwide", countries: [] },
  });
  assert.ok(
    validateOpeningContent(content).includes("remote_eligibility.countries"),
  );
});

test("salary accepts the cap and refuses one unit above it", () => {
  assert.deepEqual(
    validateOpeningContent({
      ...valid(),
      salary: {
        currency: "USD",
        min: MaxOpeningSalary,
        max: MaxOpeningSalary,
        period: "year",
      },
    }),
    [],
  );
  assert.ok(
    validateOpeningContent({
      ...valid(),
      salary: {
        currency: "USD",
        min: 0,
        max: MaxOpeningSalary + 1,
        period: "year",
      },
    }).includes("salary.max"),
  );
});
