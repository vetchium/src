import assert from "node:assert/strict";
import test from "node:test";

import {
  type ApplicantSnapshot,
  validateApplicantSnapshot,
} from "./snapshot.ts";

const snapshot: ApplicantSnapshot = {
  display_name: "Ada Lovelace",
  handle: "abcd1234-0123456789a",
  resident_country: "GB",
  websites: [],
  work_experiences: [],
  certifications: [],
  language_abilities: [],
  educational_qualifications: [],
};

test("a snapshot validates its identity fields and array bounds", () => {
  assert.deepEqual(validateApplicantSnapshot(snapshot), []);
  assert.deepEqual(
    validateApplicantSnapshot({
      ...snapshot,
      display_name: "",
      handle: "x",
      resident_country: "ZZ",
      biography: "é".repeat(2001),
      websites: new Array(11).fill({}),
      work_experiences: new Array(51).fill({}),
      certifications: new Array(51).fill({}),
      language_abilities: new Array(76).fill({}),
      educational_qualifications: new Array(31).fill({}),
    }),
    [
      "display_name",
      "handle",
      "resident_country",
      "biography",
      "websites",
      "work_experiences",
      "certifications",
      "language_abilities",
      "educational_qualifications",
    ],
  );
});
