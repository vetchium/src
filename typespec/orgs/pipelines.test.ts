import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCreatePipelineTemplateRequest,
  validateCreatePipelineTemplateRequest,
  validateDeletePipelineTemplateRequest,
  validateListPipelineTemplatesRequest,
  validateUpdatePipelineTemplateRequest,
} from "./hiring/pipelines.ts";
import {
  validateCreateOpeningRequest,
  validateDuplicateOpeningRequest,
} from "./openings/openings.ts";
import {
  normalizeReplaceOpeningPipelineRequest,
  validateGetOpeningPipelineRequest,
  validateReplaceOpeningPipelineRequest,
} from "./openings/pipeline.ts";

const id = "01900000-0000-7000-8000-000000000000";
const stage = { name: "Screen", kind: "review" } as const;

test("pipeline template normalization leaves the caller's values intact", () => {
  const request = {
    name: "  Hiring ",
    stages: [{ name: " Screen ", kind: "review" as const }],
  };
  const normalized = normalizeCreatePipelineTemplateRequest(request);
  assert.equal(normalized.name, "Hiring");
  assert.equal(normalized.stages[0].name, "Screen");
  assert.equal(request.name, "  Hiring ");
  assert.equal(request.stages[0].name, " Screen ");
});

test("pipeline template requests validate names, bounds, kinds, and ids", () => {
  const many = (count: number) => Array.from({ length: count }, () => stage);
  assert.deepEqual(
    validateCreatePipelineTemplateRequest({ name: "A", stages: many(15) }),
    [],
  );
  assert.deepEqual(
    validateCreatePipelineTemplateRequest({ name: "A", stages: many(16) }),
    ["stages"],
  );
  assert.deepEqual(
    validateCreatePipelineTemplateRequest({ name: "A", stages: [] }),
    ["stages"],
  );
  assert.deepEqual(
    validateCreatePipelineTemplateRequest({
      name: "é".repeat(100),
      stages: many(1),
    }),
    [],
  );
  assert.deepEqual(
    validateCreatePipelineTemplateRequest({
      name: "é".repeat(101),
      stages: many(1),
    }),
    ["name"],
  );
  assert.deepEqual(
    validateCreatePipelineTemplateRequest({
      name: "A",
      stages: [
        { name: "", kind: "review" },
        { name: "B", kind: "mystery" as never },
      ],
    }),
    ["stages.0.name", "stages.1.kind"],
  );
  assert.deepEqual(
    validateUpdatePipelineTemplateRequest({
      template_id: "x",
      name: "A",
      stages: many(1),
    }),
    ["template_id"],
  );
  assert.deepEqual(
    validateDeletePipelineTemplateRequest({ template_id: id }),
    [],
  );
  assert.deepEqual(validateDeletePipelineTemplateRequest({ template_id: "" }), [
    "template_id",
  ]);
  assert.deepEqual(validateListPipelineTemplatesRequest({ limit: 0 }), [
    "limit",
  ]);
  assert.deepEqual(validateListPipelineTemplatesRequest({}), []);
});

test("Opening pipeline requests validate ids, bounds, and the template choice", () => {
  const request = {
    opening_number: 1,
    version: 1,
    stages: [
      { id, name: " Screen ", kind: "review" as const },
      { id, name: "Again", kind: "review" as const },
    ],
  };
  const normalized = normalizeReplaceOpeningPipelineRequest(request);
  assert.equal(normalized.stages[0].name, "Screen");
  assert.equal(request.stages[0].name, " Screen ");
  assert.deepEqual(validateReplaceOpeningPipelineRequest(normalized), [
    "stages.1.id",
  ]);
  assert.deepEqual(
    validateReplaceOpeningPipelineRequest({
      opening_number: 0,
      version: 0,
      stages: [],
    }),
    ["opening_number", "version", "stages"],
  );
  assert.deepEqual(validateGetOpeningPipelineRequest({ opening_number: 0 }), [
    "opening_number",
  ]);
  assert.deepEqual(
    validateDuplicateOpeningRequest({
      opening_number: 1,
      pipeline_template_id: "nope",
    }),
    ["pipeline_template_id"],
  );
  assert.deepEqual(
    validateCreateOpeningRequest({
      content: {},
      team_member_emails: [],
      pipeline_template_id: "nope",
    }),
    ["pipeline_template_id"],
  );
});

test("feedback forms belong to interview stages with bounded, unique criteria", () => {
  const criterion = { text: "Depth", type: "rating", required: true };
  const panel = (form: (typeof criterion & { id?: string })[]) => ({
    name: "Panel",
    kind: "interview" as const,
    feedback_form: form,
  });
  assert.deepEqual(
    validateCreatePipelineTemplateRequest({
      name: "A",
      stages: [panel(Array.from({ length: 10 }, () => criterion))],
    }),
    [],
  );
  assert.deepEqual(
    validateCreatePipelineTemplateRequest({
      name: "A",
      stages: [
        panel(Array.from({ length: 11 }, () => criterion)),
        { name: "Screen", kind: "review", feedback_form: [criterion] },
        panel([
          { ...criterion, id },
          { text: " Fit", type: "stars", required: false },
        ]),
        panel([{ ...criterion, id }]),
      ],
    }),
    [
      "stages.0.feedback_form",
      "stages.1.feedback_form",
      "stages.2.feedback_form.1.text",
      "stages.2.feedback_form.1.type",
      "stages.3.feedback_form.0.id",
    ],
  );
  const request = {
    opening_number: 1,
    version: 1,
    stages: [panel([{ ...criterion, text: " Depth " }])],
  };
  const normalized = normalizeReplaceOpeningPipelineRequest(request);
  assert.equal(normalized.stages[0].feedback_form?.[0]?.text, "Depth");
  assert.equal(request.stages[0].feedback_form[0].text, " Depth ");
  assert.deepEqual(validateReplaceOpeningPipelineRequest(normalized), []);
  assert.deepEqual(
    validateReplaceOpeningPipelineRequest({
      ...request,
      stages: [{ name: "Screen", kind: "review", feedback_form: [criterion] }],
    }),
    ["stages.0.feedback_form"],
  );
});
