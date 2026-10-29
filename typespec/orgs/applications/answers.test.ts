import assert from "node:assert/strict";
import test from "node:test";
import {
  type ApplicationAnswer,
  isAnswerColumnQuestion,
  maxApplicationAnswers,
  maxLongTextAnswer,
  normalizeAnswers,
  validateAnswerShapes,
} from "./answers.ts";

const id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const long = "界".repeat(maxLongTextAnswer);

test("answer normalization trims a copy", () => {
  const source: ApplicationAnswer[] = [
    { question_id: id, value: "  text  " },
    { question_id: id, value: [" a ", "b "] },
    { question_id: id, value: 4 },
  ];
  assert.deepEqual(normalizeAnswers(source), [
    { question_id: id, value: "text" },
    { question_id: id, value: ["a", "b"] },
    { question_id: id, value: 4 },
  ]);
  assert.equal(source[0]?.value, "  text  ");
  assert.deepEqual(source[1]?.value, [" a ", "b "]);
});

test("answer shapes accept every kind at its bounds", () => {
  assert.deepEqual(
    validateAnswerShapes([
      { question_id: id, value: long },
      { question_id: id, value: "" },
      { question_id: id, value: -1 },
      { question_id: id, value: false },
      { question_id: id, value: Array.from({ length: 8 }, () => long) },
      { question_id: id, value: [] },
    ]),
    [],
  );
});

const invalid: [string, ApplicationAnswer[], string[]][] = [
  [
    "eleven answers",
    Array.from({ length: maxApplicationAnswers + 1 }, () => ({
      question_id: id,
      value: true,
    })),
    ["answers"],
  ],
  [
    "bad question id",
    [{ question_id: "Q1", value: true }],
    ["answers.0.question_id"],
  ],
  [
    "text too long",
    [{ question_id: id, value: `${long}x` }],
    ["answers.0.value"],
  ],
  ["fraction", [{ question_id: id, value: 1.5 }], ["answers.0.value"]],
  [
    "nine options",
    [{ question_id: id, value: Array.from({ length: 9 }, () => "a") }],
    ["answers.0.value"],
  ],
  [
    "option too long",
    [{ question_id: id, value: [`${long}x`] }],
    ["answers.0.value"],
  ],
  [
    "null value",
    [{ question_id: id, value: null as unknown as string }],
    ["answers.0.value"],
  ],
];

for (const [name, answers, fields] of invalid) {
  test(name, () => assert.deepEqual(validateAnswerShapes(answers), fields));
}

test("only short answers can be list columns", () => {
  assert.deepEqual(
    [
      "short_text",
      "long_text",
      "number",
      "yes_no",
      "single_choice",
      "multiple_choice",
    ].map(isAnswerColumnQuestion),
    [false, false, true, true, true, true],
  );
});
