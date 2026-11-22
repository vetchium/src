import assert from "node:assert/strict";
import test from "node:test";
import { matchingSuggestions } from "./suggestions.ts";

const address = (email: string) => [email];

test("an exact match comes first, then prefixes, then other matches", () => {
  const held = ["abo@x.test", "bo@x.test.example", "cy@x.test", "bo@x.test"];
  assert.deepEqual(matchingSuggestions(held, "bo@x.test", address), [
    "bo@x.test",
    "bo@x.test.example",
    "abo@x.test",
  ]);
});

test("suggestions left from an earlier search that do not match are dropped", () => {
  assert.deepEqual(matchingSuggestions(["al@x.test"], "bo", address), []);
});

test("equal matches keep their order, ignoring case and outer spaces", () => {
  assert.deepEqual(
    matchingSuggestions(["bob@x.test", "bo@x.test"], " BO ", address),
    ["bob@x.test", "bo@x.test"],
  );
});

test("any of a suggestion's texts matches", () => {
  const jobs = [
    { title: "Level 2 engineer", number: "7" },
    { title: "Designer", number: "2" },
  ];
  assert.deepEqual(
    matchingSuggestions(jobs, "2", (job) => [job.title, job.number]),
    [jobs[1], jobs[0]],
  );
});

test("case folds as the API's search does", () => {
  for (const [name, typed] of [
    ["İstanbul Tech", "istanbul"],
    ["ΝΙΚΟΣ", "νικοσ"],
  ] as const) {
    assert.deepEqual(matchingSuggestions([name], typed, address), [name]);
  }
});

test("no text keeps every suggestion as given", () => {
  assert.deepEqual(matchingSuggestions(["b", "a"], " ", address), ["b", "a"]);
});
