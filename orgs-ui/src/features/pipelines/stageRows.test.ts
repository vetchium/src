import assert from "node:assert/strict";
import test from "node:test";
import {
  keptRows,
  moveRow,
  newRow,
  removeRow,
  rowsFromStages,
  rowsProblem,
  sameRows,
  toDefinitions,
  toInputs,
  updateRow,
} from "./stageRows.ts";

const stages = [
  { id: "a", name: "Screen", kind: "review" as const },
  { id: "b", name: "Panel", kind: "interview" as const },
  { id: "c", name: "Final", kind: "interview" as const },
];

test("removing a stored stage marks it and a new stage disappears", () => {
  const rows = [...rowsFromStages(stages), newRow("review", "Extra")];
  const marked = removeRow(rows, 1);
  assert.equal(marked[1]?.removed, true);
  assert.equal(marked.length, 4);
  assert.equal(removeRow(rows, 3).length, 3);
});

test("moving skips stages marked for removal", () => {
  const rows = removeRow(rowsFromStages(stages), 1);
  const moved = moveRow(rows, 2, -1);
  assert.deepEqual(
    moved.map((row) => row.id),
    ["c", "b", "a"],
  );
  assert.deepEqual(
    moveRow(rows, 0, -1).map((row) => row.id),
    ["a", "b", "c"],
  );
});

test("the request keeps ids of stored stages and omits them for new ones", () => {
  const rows = [
    ...removeRow(rowsFromStages(stages), 0),
    { ...newRow("assessment"), name: "  Exercise  " },
  ];
  assert.deepEqual(toInputs(rows), [
    { id: "b", name: "Panel", kind: "interview" },
    { id: "c", name: "Final", kind: "interview" },
    { name: "Exercise", kind: "assessment" },
  ]);
  assert.equal(keptRows(rows).length, 3);
});

test("a pipeline needs one to fifteen named stages", () => {
  const rows = rowsFromStages(stages);
  assert.equal(rowsProblem(rows), "none");
  assert.equal(rowsProblem([]), "empty");
  assert.equal(rowsProblem(updateRow(rows, 0, { name: "  " })), "name");
  const many = Array.from({ length: 16 }, () => newRow("review", "Stage"));
  assert.equal(rowsProblem(many), "tooMany");
});

test("a restored stage equals the stored one", () => {
  const rows = rowsFromStages(stages);
  const changed = removeRow(rows, 0);
  assert.equal(sameRows(rows, changed), false);
  assert.equal(sameRows(rows, updateRow(changed, 0, { removed: false })), true);
});

test("forms travel with their criterion ids, and only interview stages send one", () => {
  const criterion = {
    id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a50",
    text: "Depth",
    type: "rating" as const,
    required: true,
  };
  const rows = rowsFromStages([
    { id: "a", name: "Screen", kind: "review" as const },
    { id: "b", name: "Panel", kind: "interview", feedback_form: [criterion] },
  ]);
  assert.deepEqual(toInputs(rows)[1]?.feedback_form, [criterion]);
  assert.equal("feedback_form" in (toInputs(rows)[0] ?? {}), false);
  // A new stage switched away from interview keeps its draft form unsent.
  const switched = updateRow([newRow("interview", "Call")], 0, {
    form: [{ text: " Clarity ", type: "yes_no", required: false }],
  });
  assert.deepEqual(toDefinitions(switched)[0]?.feedback_form, [
    { text: "Clarity", type: "yes_no", required: false },
  ]);
  assert.equal(
    "feedback_form" in
      (toDefinitions(updateRow(switched, 0, { kind: "review" }))[0] ?? {}),
    false,
  );
});

test("a form change makes the rows differ, and a blank criterion blocks saving", () => {
  const rows = rowsFromStages(stages);
  const formed = updateRow(rows, 1, {
    form: [{ text: "", type: "text", required: false }],
  });
  assert.equal(sameRows(rows, formed), false);
  assert.equal(rowsProblem(formed), "criterion");
  // A form on a review stage is never sent, so it never blocks or differs.
  const review = updateRow(rows, 0, {
    form: [{ text: "", type: "text", required: false }],
  });
  assert.equal(sameRows(rows, review), true);
  assert.equal(rowsProblem(review), "none");
});
