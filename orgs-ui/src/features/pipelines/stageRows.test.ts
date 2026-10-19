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
