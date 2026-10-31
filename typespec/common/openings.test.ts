import assert from "node:assert/strict";
import test from "node:test";
import {
  type ApplicationQuestion,
  MaxOpeningSalary,
  maxQuestionNumber,
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

type QuestionSet = [
  ApplicationQuestion,
  ApplicationQuestion,
  ApplicationQuestion,
  ApplicationQuestion,
  ApplicationQuestion,
  ApplicationQuestion,
];

const questions = (): QuestionSet => [
  {
    id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
    text: "Notice period in days",
    type: "number",
    required: true,
    min: 0,
    max: maxQuestionNumber,
  },
  { text: "界".repeat(500), type: "short_text", required: false },
  { text: "Why us?", type: "long_text", required: false },
  { text: "Authorized to work in Germany?", type: "yes_no", required: true },
  {
    text: "Preferred office",
    type: "single_choice",
    required: false,
    options: ["Berlin", "Munich"],
  },
  {
    text: "Languages",
    type: "multiple_choice",
    required: false,
    options: ["a", "b", "c", "d", "e", "f", "g", "界".repeat(200)],
  },
];

const invalidQuestions: [
  string,
  (q: QuestionSet) => ApplicationQuestion[],
  string,
][] = [
  [
    "too many questions",
    (q) => [...q, q[1], q[2], q[3], q[1], q[2]],
    "questions",
  ],
  [
    "malformed question id",
    (q) => {
      q[0].id = "0190A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B";
      return q;
    },
    "questions.0.id",
  ],
  [
    "duplicate question id",
    (q) => {
      q[1].id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
      return q;
    },
    "questions.1.id",
  ],
  [
    "empty question text",
    (q) => {
      q[2].text = "";
      return q;
    },
    "questions.2.text",
  ],
  [
    "question text too long",
    (q) => {
      q[2].text = "界".repeat(501);
      return q;
    },
    "questions.2.text",
  ],
  [
    "unknown question type",
    (q) => {
      q[2].type = "date";
      return q;
    },
    "questions.2.type",
  ],
  [
    "number min below",
    (q) => {
      q[0].min = -1;
      return q;
    },
    "questions.0.min",
  ],
  [
    "number min fractional",
    (q) => {
      q[0].min = 1.5;
      return q;
    },
    "questions.0.min",
  ],
  [
    "number max above",
    (q) => {
      q[0].max = maxQuestionNumber + 1;
      return q;
    },
    "questions.0.max",
  ],
  [
    "number min above max",
    (q) => {
      q[0].min = 5;
      q[0].max = 4;
      return q;
    },
    "questions.0.max",
  ],
  [
    "min on text",
    (q) => {
      q[1].min = 1;
      return q;
    },
    "questions.1.min",
  ],
  [
    "max on choice",
    (q) => {
      q[4].max = 1;
      return q;
    },
    "questions.4.max",
  ],
  [
    "options on number",
    (q) => {
      q[0].options = ["a", "b"];
      return q;
    },
    "questions.0.options",
  ],
  [
    "options on yes no",
    (q) => {
      q[3].options = [];
      return q;
    },
    "questions.3.options",
  ],
  [
    "choice without options",
    (q) => {
      delete q[4].options;
      return q;
    },
    "questions.4.options",
  ],
  [
    "one option",
    (q) => {
      q[4].options = ["Berlin"];
      return q;
    },
    "questions.4.options",
  ],
  [
    "nine options",
    (q) => {
      q[5].options = [...(q[5].options ?? []), "i"];
      return q;
    },
    "questions.5.options",
  ],
  [
    "empty option",
    (q) => {
      q[4].options = ["Berlin", ""];
      return q;
    },
    "questions.4.options.1",
  ],
  [
    "option too long",
    (q) => {
      q[4].options = ["Berlin", "界".repeat(201)];
      return q;
    },
    "questions.4.options.1",
  ],
  [
    "duplicate option ignoring case",
    (q) => {
      q[4].options = ["Berlin", "BERLIN"];
      return q;
    },
    "questions.4.options.1",
  ],
];

for (const [name, change, field] of invalidQuestions) {
  test(name, () =>
    assert.deepEqual(
      validateOpeningContent({ ...valid(), questions: change(questions()) }),
      [field],
    ),
  );
}

test("question boundaries are valid and never required for publication", () => {
  const content = { ...valid(), questions: questions() };
  assert.deepEqual(validateOpeningContent(content), []);
  assert.deepEqual(missingForPublication(content), []);
});

test("question normalization makes a copy", () => {
  const source: OpeningContent = {
    questions: [
      {
        text: "  Office  ",
        type: "single_choice",
        required: false,
        options: [" Berlin ", "Munich "],
      },
    ],
  };
  const normalized = normalizeOpeningContent(source);
  assert.equal(source.questions?.[0]?.text, "  Office  ");
  assert.deepEqual(normalized.questions, [
    {
      text: "Office",
      type: "single_choice",
      required: false,
      options: ["Berlin", "Munich"],
    },
  ]);
});
