import assert from "node:assert/strict";
import test from "node:test";
import type { TFunction } from "i18next";
import type { EmailAddress } from "typespec/common/common";
import type { OpeningContent } from "typespec/common/openings";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { publicationFieldLabels, publicationGaps } from "./publication.ts";

const complete: OpeningContent = {
  title: "Engineer",
  description: "Build services",
  language: "en",
  employing_country: "SG",
  work_arrangement: "on_site",
  employment_type: "full_time",
  positions: 1,
};
const member = {
  email: "owner@example.com" as EmailAddress,
  active: true,
};

function opening(changes: Partial<OrgOpening>): OrgOpening {
  return {
    opening_number: 1,
    state: "draft",
    version: 1,
    revision: 0,
    team_members: [],
    created_by_email: member.email,
    created_at: "2026-10-13T10:00:00Z",
    updated_at: "2026-10-13T10:00:00Z",
    ...changes,
  } as OrgOpening;
}

const t = ((key: string) => key) as unknown as TFunction;

test("a draft lists its missing content and hiring team in problem form", () => {
  assert.deepEqual(
    publicationGaps(opening({ working_content: { title: "Engineer" } })),
    [
      "content.description",
      "content.language",
      "content.employing_country",
      "content.work_arrangement",
      "content.employment_type",
      "content.positions",
      "hiring_manager_email",
      "recruiter_email",
    ],
  );
  assert.deepEqual(
    publicationGaps(
      opening({
        working_content: { ...complete, work_arrangement: "remote" },
        hiring_manager: member,
        recruiter: member,
      }),
    ),
    ["content.remote_eligibility"],
  );
  assert.deepEqual(
    publicationGaps(
      opening({
        working_content: complete,
        hiring_manager: member,
        recruiter: member,
      }),
    ),
    [],
  );
});

test("a draft without content misses every required field", () => {
  assert.equal(publicationGaps(opening({})).length, 9);
});

test("only a revision working copy of a live Opening is checked", () => {
  const live = {
    live_content: complete,
    hiring_manager: member,
    recruiter: member,
  };
  assert.deepEqual(
    publicationGaps(opening({ ...live, state: "published" })),
    [],
  );
  assert.deepEqual(
    publicationGaps(
      opening({
        ...live,
        state: "paused",
        working_content: { ...complete, positions: undefined },
      }),
    ),
    ["content.positions"],
  );
  for (const state of ["closed", "expired", "discarded"] as const) {
    assert.deepEqual(
      publicationGaps(opening({ state, working_content: {} })),
      [],
    );
  }
});

test("labels collapse nested paths and keep unknown fields readable", () => {
  assert.deepEqual(
    publicationFieldLabels(t, [
      "content.employing_country",
      "content.salary.min",
      "content.salary.max",
      "hiring_manager_email",
      "recruiter_email",
      "content.future_field",
    ]),
    [
      "openings.fields.country",
      "openings.fields.salary",
      "openings.fields.hiringManager",
      "openings.editor.recruiter",
      "content.future_field",
    ],
  );
});
