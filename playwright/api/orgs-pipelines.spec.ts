import { expect } from "@playwright/test";
import type { ApplicationDetail } from "typespec/orgs/applications/applications";
import type {
  FeedbackCriterion,
  PipelineStage,
  PipelineStageDefinition,
  PipelineTemplate,
} from "typespec/orgs/hiring/pipelines";
import type {
  OpeningPipeline,
  ReplaceOpeningPipelineRequest,
} from "typespec/orgs/openings/pipeline";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { sqlLiteral } from "../lib/admin-db.ts";
import { test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  cleanupApplicants,
  type HiringOrg,
  seedApplication,
} from "../lib/hiring-seed.ts";
import {
  addOrgMember,
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgAuditEventsByKey,
  orgDID,
  orgSQL,
  orgsIdempotencyKey,
  signupOrg,
} from "../lib/orgs-api.ts";
import {
  cleanupOutbox,
  openingContent,
  publishedOpening,
} from "../lib/orgs-applications.ts";

const interview = (name: string): PipelineStageDefinition => ({
  name,
  kind: "interview",
});
const review = (name: string): PipelineStageDefinition => ({
  name,
  kind: "review",
});

type Api = OrgsAPI;

/** The stage at `index`; a missing one fails the test with a clear error. */
function stageAt(pipeline: { stages: PipelineStage[] }, index: number) {
  const stage = pipeline.stages[index];
  if (!stage) throw new Error(`pipeline has no stage ${index}`);
  return stage;
}

async function newTemplate(
  api: Api,
  token: string,
  name: string,
  stages: PipelineStageDefinition[] = [review("Screen"), interview("Panel")],
): Promise<PipelineTemplate> {
  const response = await api.createPipelineTemplate(token, { name, stages });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as PipelineTemplate;
}

async function newOpening(
  api: Api,
  token: string,
  extra: { pipeline_template_id?: string } = {},
): Promise<OrgOpening> {
  const response = await api.createOpening(token, {
    content: { title: "Engineer" },
    team_member_emails: [],
    ...extra,
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as OrgOpening;
}

/** A draft with the content publishing needs, the owner its whole team. */
async function fullOpening(
  api: Api,
  token: string,
  org: { emailAddress: string },
): Promise<OrgOpening> {
  const response = await api.createOpening(token, {
    content: openingContent("Engineer"),
    hiring_manager_email: org.emailAddress,
    recruiter_email: org.emailAddress,
    team_member_emails: [],
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as OrgOpening;
}

async function pipelineOf(
  api: Api,
  token: string,
  number: number,
): Promise<OpeningPipeline> {
  const response = await api.getOpeningPipeline(token, {
    opening_number: number,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as OpeningPipeline;
}

const shape = (stages: PipelineStage[] | PipelineStageDefinition[]) =>
  stages.map(({ name, kind }) => ({ name, kind }));

/** Moves the Opening through its own request API; the owner self-approves. */
async function changeOpening(
  api: Api,
  token: string,
  number: number,
  kind: "publish" | "pause" | "close",
): Promise<void> {
  const current = await api.getOpening(token, { opening_number: number });
  const response = await api.requestOpeningChange(token, {
    opening_number: number,
    version: ((await current.json()) as OrgOpening).version,
    kind,
  });
  expect(response.status(), await response.text()).toBe(200);
}

/** Creates `count` templates through the API, a few at a time. */
async function createTemplates(
  api: Api,
  token: string,
  count: number,
): Promise<void> {
  for (let start = 1; start <= count; start += 10) {
    const batch = Array.from(
      { length: Math.min(10, count - start + 1) },
      (_, index) => start + index,
    );
    for (const response of await Promise.all(
      batch.map((n) =>
        api.createPipelineTemplate(token, {
          name: `Bulk ${n}`,
          stages: [review("Screen")],
        }),
      ),
    )) {
      expect(response.status(), await response.text()).toBe(201);
    }
  }
}

async function withOrg(
  request: ConstructorParameters<typeof OrgsAPI>[0],
  body: (
    api: Api,
    owner: string,
    org: Awaited<ReturnType<typeof signupOrg>>,
  ) => Promise<void>,
): Promise<void> {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    await body(api, await loginOrg(api, org), org);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
}

test("pipeline template create, list, update, and delete", async ({
  request,
}) => {
  await withOrg(request, async (api, owner) => {
    const createKey = orgsIdempotencyKey();
    const createdResponse = await api.createPipelineTemplate(
      owner,
      {
        name: "  Engineering hiring  ",
        stages: [
          review("Resume screen"),
          { name: "Take-home", kind: "assessment" },
          interview("Onsite"),
          { name: "References", kind: "background_check" },
        ],
      },
      createKey,
    );
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    expect(createdResponse.headers()["cache-control"]).toBe("no-store");
    const created = (await createdResponse.json()) as PipelineTemplate;
    expect(created).toMatchObject({
      name: "Engineering hiring",
      stages: [
        { name: "Resume screen", kind: "review" },
        { name: "Take-home", kind: "assessment" },
        { name: "Onsite", kind: "interview" },
        { name: "References", kind: "background_check" },
      ],
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

    const replay = await api.createPipelineTemplate(
      owner,
      {
        name: "  Engineering hiring  ",
        stages: [
          review("Resume screen"),
          { name: "Take-home", kind: "assessment" },
          interview("Onsite"),
          { name: "References", kind: "background_check" },
        ],
      },
      createKey,
    );
    expect(replay.status(), await replay.text()).toBe(201);
    expect(await replay.json()).toEqual(created);
    expect(orgAuditEventsByKey(createKey)).toHaveLength(1);
    expect(JSON.stringify(orgAuditEventsByKey(createKey))).not.toContain(
      "Engineering hiring",
    );

    const conflictingReplay = await api.createPipelineTemplate(
      owner,
      { name: "Other", stages: [review("Screen")] },
      createKey,
    );
    expect(conflictingReplay.status()).toBe(409);
    expect((await conflictingReplay.json()).type).toContain(
      "idempotency-key-conflict",
    );

    const list = await api.listPipelineTemplates(owner);
    expect(list.status(), await list.text()).toBe(200);
    expect((await list.json()).templates).toEqual([created]);

    const updateKey = orgsIdempotencyKey();
    const updatedResponse = await api.updatePipelineTemplate(
      owner,
      {
        template_id: created.id,
        name: "Platform hiring",
        stages: [interview("Only stage")],
      },
      updateKey,
    );
    expect(updatedResponse.status(), await updatedResponse.text()).toBe(200);
    const updated = (await updatedResponse.json()) as PipelineTemplate;
    expect(updated).toMatchObject({
      id: created.id,
      name: "Platform hiring",
      stages: [{ name: "Only stage", kind: "interview" }],
      created_at: created.created_at,
    });
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(created.updated_at),
    );
    expect(orgAuditEventsByKey(updateKey)).toHaveLength(1);
    const updateKeyConflict = await api.updatePipelineTemplate(
      owner,
      { template_id: created.id, name: "Different", stages: [review("X")] },
      updateKey,
    );
    expect(updateKeyConflict.status(), await updateKeyConflict.text()).toBe(
      409,
    );
    expect((await updateKeyConflict.json()).type).toContain(
      "idempotency-key-conflict",
    );

    // Growing the list again proves the removed positions were not kept.
    const regrown = await api.updatePipelineTemplate(owner, {
      template_id: created.id,
      name: "Platform hiring",
      stages: [review("A"), review("B"), interview("C")],
    });
    expect(regrown.status(), await regrown.text()).toBe(200);
    expect(shape(((await regrown.json()) as PipelineTemplate).stages)).toEqual([
      { name: "A", kind: "review" },
      { name: "B", kind: "review" },
      { name: "C", kind: "interview" },
    ]);

    const deleteKey = orgsIdempotencyKey();
    const deleted = await api.deletePipelineTemplate(
      owner,
      { template_id: created.id },
      deleteKey,
    );
    expect(deleted.status(), await deleted.text()).toBe(204);
    expect(await deleted.text()).toBe("");
    const deleteReplay = await api.deletePipelineTemplate(
      owner,
      { template_id: created.id },
      deleteKey,
    );
    expect(deleteReplay.status()).toBe(204);
    expect(orgAuditEventsByKey(deleteKey)).toHaveLength(1);
    const deleteKeyConflict = await api.deletePipelineTemplate(
      owner,
      { template_id: "01900000-0000-7000-8000-000000000000" },
      deleteKey,
    );
    expect(deleteKeyConflict.status(), await deleteKeyConflict.text()).toBe(
      409,
    );
    expect((await deleteKeyConflict.json()).type).toContain(
      "idempotency-key-conflict",
    );
    expect(
      (await (await api.listPipelineTemplates(owner)).json()).templates,
    ).toEqual([]);

    const again = await api.deletePipelineTemplate(owner, {
      template_id: created.id,
    });
    expect(again.status(), await again.text()).toBe(404);
    expect((await again.json()).type).toContain(
      "org-pipeline-template-not-found",
    );
    const missingUpdate = await api.updatePipelineTemplate(owner, {
      template_id: created.id,
      name: "Gone",
      stages: [review("Screen")],
    });
    expect(missingUpdate.status(), await missingUpdate.text()).toBe(404);
    expect((await missingUpdate.json()).type).toContain(
      "org-pipeline-template-not-found",
    );
  });
});

test("template names are unique per Org regardless of case", async ({
  request,
}) => {
  await withOrg(request, async (api, owner) => {
    const first = await newTemplate(api, owner, "Engineering");
    const second = await newTemplate(api, owner, "Design");

    for (const name of ["engineering", "ENGINEERING", "  EnGiNeErInG "]) {
      const taken = await api.createPipelineTemplate(owner, {
        name,
        stages: [review("Screen")],
      });
      expect(taken.status(), await taken.text()).toBe(409);
      expect((await taken.json()).type).toContain(
        "org-pipeline-template-name-taken",
      );
    }
    const renamedOnto = await api.updatePipelineTemplate(owner, {
      template_id: second.id,
      name: "eNGINEERING",
      stages: [review("Screen")],
    });
    expect(renamedOnto.status(), await renamedOnto.text()).toBe(409);
    expect((await renamedOnto.json()).type).toContain(
      "org-pipeline-template-name-taken",
    );
    const unchanged = await api.listPipelineTemplates(owner);
    expect(
      ((await unchanged.json()).templates as PipelineTemplate[]).map(
        (template) => template.name,
      ),
    ).toEqual(["Design", "Engineering"]);

    // A template may change only the case of its own name.
    const recased = await api.updatePipelineTemplate(owner, {
      template_id: first.id,
      name: "ENGINEERING",
      stages: [review("Screen")],
    });
    expect(recased.status(), await recased.text()).toBe(200);
    expect(((await recased.json()) as PipelineTemplate).name).toBe(
      "ENGINEERING",
    );

    // The name is free again once its owner is deleted.
    const deleted = await api.deletePipelineTemplate(owner, {
      template_id: first.id,
    });
    expect(deleted.status()).toBe(204);
    await newTemplate(api, owner, "engineering");
  });

  // Names are scoped to one Org.
  const apiA = new OrgsAPI(request);
  const orgA = await signupOrg(apiA);
  const orgB = await signupOrg(apiA);
  try {
    const tokenA = await loginOrg(apiA, orgA);
    const tokenB = await loginOrg(apiA, orgB);
    await newTemplate(apiA, tokenA, "Shared name");
    await newTemplate(apiA, tokenB, "Shared name");
  } finally {
    await deleteOrgVerificationRecord(orgA.domain);
    await deleteOrgVerificationRecord(orgB.domain);
    cleanupOrg(orgA.domain);
    cleanupOrg(orgB.domain);
  }
});

test("template and stage bounds", async ({ request }) => {
  await withOrg(request, async (api, owner, _org) => {
    const fifteen = Array.from({ length: 15 }, (_, index) =>
      review(`Stage ${index + 1}`),
    );
    const ok = await api.createPipelineTemplate(owner, {
      name: "é".repeat(100),
      stages: fifteen,
    });
    expect(ok.status(), await ok.text()).toBe(201);
    expect(((await ok.json()) as PipelineTemplate).stages).toHaveLength(15);

    const tooManyStages = await api.createPipelineTemplate(owner, {
      name: "Sixteen",
      stages: [...fifteen, review("Stage 16")],
    });
    expect(tooManyStages.status()).toBe(400);
    expect((await tooManyStages.json()).type).toContain("validation-failed");
    const noStages = await api.createPipelineTemplate(owner, {
      name: "None",
      stages: [],
    });
    expect(noStages.status()).toBe(400);
    expect((await noStages.json()).fields).toEqual(["stages"]);

    const longName = await api.createPipelineTemplate(owner, {
      name: "é".repeat(101),
      stages: [review("Screen")],
    });
    expect(longName.status()).toBe(400);
    expect((await longName.json()).fields).toEqual(["name"]);
    const blankName = await api.createPipelineTemplate(owner, {
      name: "   ",
      stages: [review("Screen")],
    });
    expect(blankName.status()).toBe(400);
    expect((await blankName.json()).fields).toEqual(["name"]);

    const badStages = await api.post(
      "/create-pipeline-template",
      {
        name: "Bad stages",
        stages: [
          { name: "", kind: "review" },
          { name: "x".repeat(101), kind: "review" },
          { name: "Fine", kind: "unknown-kind" },
        ],
      },
      { token: owner, idempotencyKey: orgsIdempotencyKey() },
    );
    expect(badStages.status()).toBe(400);
    expect((await badStages.json()).fields).toEqual([
      "stages.0.name",
      "stages.1.name",
      "stages.2.kind",
    ]);

    // 50 templates is the limit: 48 more, then the 50th and the refused 51st.
    await createTemplates(api, owner, 48);
    const fiftieth = await api.createPipelineTemplate(owner, {
      name: "Fiftieth",
      stages: [review("Screen")],
    });
    expect(fiftieth.status(), await fiftieth.text()).toBe(201);
    const fiftyFirst = await api.createPipelineTemplate(owner, {
      name: "Fifty first",
      stages: [review("Screen")],
    });
    expect(fiftyFirst.status(), await fiftyFirst.text()).toBe(409);
    expect(await fiftyFirst.json()).toMatchObject({
      type: expect.stringContaining("org-pipeline-template-limit-reached"),
      limit: 50,
    });
    // Updating at the limit is not creating.
    const update = await api.updatePipelineTemplate(owner, {
      template_id: ((await fiftieth.json()) as PipelineTemplate).id,
      name: "Fiftieth renamed",
      stages: [review("Screen")],
    });
    expect(update.status(), await update.text()).toBe(200);
  });
});

test("concurrent creations cannot exceed the template limit or reuse a name", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, _org) => {
    await createTemplates(api, owner, 49);
    const results = await Promise.all(
      ["Race A", "Race B", "Race C"].map((name) =>
        api.createPipelineTemplate(owner, { name, stages: [review("Screen")] }),
      ),
    );
    expect(results.map((response) => response.status()).sort()).toEqual([
      201, 409, 409,
    ]);

    const listed = await api.listPipelineTemplates(owner, { limit: 100 });
    expect(listed.status(), await listed.text()).toBe(200);
    for (const template of (
      (await listed.json()) as { templates: PipelineTemplate[] }
    ).templates) {
      const deleted = await api.deletePipelineTemplate(owner, {
        template_id: template.id,
      });
      expect(deleted.status(), await deleted.text()).toBeLessThan(300);
    }
    const sameName = await Promise.all(
      [1, 2, 3].map(() =>
        api.createPipelineTemplate(owner, {
          name: "Same",
          stages: [review("Screen")],
        }),
      ),
    );
    expect(sameName.map((response) => response.status()).sort()).toEqual([
      201, 409, 409,
    ]);
  });
});

test("template listing is keyset paginated by name", async ({ request }) => {
  await withOrg(request, async (api, owner) => {
    for (const name of ["Charlie", "alpha", "Bravo"]) {
      await newTemplate(api, owner, name);
    }
    const names: string[] = [];
    let key: string | undefined;
    let pages = 0;
    do {
      const page = await api.listPipelineTemplates(owner, {
        limit: 2,
        ...(key ? { pagination_key: key } : {}),
      });
      expect(page.status(), await page.text()).toBe(200);
      const body = await page.json();
      names.push(...body.templates.map((item: PipelineTemplate) => item.name));
      key = body.next_pagination_key;
      pages += 1;
    } while (key && pages < 5);
    expect(pages).toBe(2);
    expect(names).toEqual(["alpha", "Bravo", "Charlie"]);

    const invalid = await api.post(
      "/list-pipeline-templates",
      { pagination_key: "not-signed" },
      { token: owner },
    );
    expect(invalid.status(), await invalid.text()).toBe(400);
    expect((await invalid.json()).type).toContain("invalid-pagination-key");
  });
});

test("a new Opening gets one review stage or copies a template", async ({
  request,
}) => {
  await withOrg(request, async (api, owner) => {
    const plain = await newOpening(api, owner);
    expect(JSON.stringify(plain)).not.toContain("stage");
    const plainPipeline = await pipelineOf(api, owner, plain.opening_number);
    expect(plainPipeline).toMatchObject({
      opening_number: plain.opening_number,
      version: plain.version,
    });
    expect(shape(plainPipeline.stages)).toEqual([
      { name: "Review", kind: "review" },
    ]);

    const template = await newTemplate(api, owner, "Standard", [
      review("Screen"),
      { name: "Test", kind: "assessment" },
      interview("Panel"),
    ]);
    const copied = await newOpening(api, owner, {
      pipeline_template_id: template.id,
    });
    const copiedPipeline = await pipelineOf(api, owner, copied.opening_number);
    expect(shape(copiedPipeline.stages)).toEqual(shape(template.stages));
    expect(copiedPipeline.stages.map((stage) => stage.id)).not.toContain(
      stageAt(plainPipeline, 0).id,
    );

    // Editing or deleting the template never changes the Opening.
    const edited = await api.updatePipelineTemplate(owner, {
      template_id: template.id,
      name: "Standard",
      stages: [review("Changed")],
    });
    expect(edited.status(), await edited.text()).toBe(200);
    expect(
      shape((await pipelineOf(api, owner, copied.opening_number)).stages),
    ).toEqual(shape(template.stages));
    const removed = await api.deletePipelineTemplate(owner, {
      template_id: template.id,
    });
    expect(removed.status()).toBe(204);
    expect(
      (await pipelineOf(api, owner, copied.opening_number)).stages,
    ).toEqual(copiedPipeline.stages);

    // A template that does not exist takes no Opening slot.
    const before = await (await api.openingSummary(owner)).json();
    const unknown = await api.createOpening(owner, {
      content: { title: "Unknown template" },
      team_member_emails: [],
      pipeline_template_id: template.id,
    });
    expect(unknown.status(), await unknown.text()).toBe(404);
    expect((await unknown.json()).type).toContain(
      "org-pipeline-template-not-found",
    );
    const after = await (await api.openingSummary(owner)).json();
    expect(after.quota.used).toBe(before.quota.used);
  });
});

test("duplicating an Opening copies its pipeline or applies a template", async ({
  request,
}) => {
  await withOrg(request, async (api, owner) => {
    const source = await newOpening(api, owner);
    const sourcePipeline = await pipelineOf(api, owner, source.opening_number);
    const replaced = await api.replaceOpeningPipeline(owner, {
      opening_number: source.opening_number,
      version: sourcePipeline.version,
      stages: [
        { id: stageAt(sourcePipeline, 0).id, name: "Screen", kind: "review" },
        { name: "Panel", kind: "interview" },
      ],
    });
    expect(replaced.status(), await replaced.text()).toBe(200);
    const replacedPipeline = (await replaced.json()) as OpeningPipeline;

    const duplicateResponse = await api.duplicateOpening(owner, {
      opening_number: source.opening_number,
    });
    expect(duplicateResponse.status(), await duplicateResponse.text()).toBe(
      201,
    );
    const duplicate = (await duplicateResponse.json()) as OrgOpening;
    const duplicatePipeline = await pipelineOf(
      api,
      owner,
      duplicate.opening_number,
    );
    expect(shape(duplicatePipeline.stages)).toEqual(
      shape(replacedPipeline.stages),
    );
    const sourceIds = replacedPipeline.stages.map((stage) => stage.id);
    for (const stage of duplicatePipeline.stages) {
      expect(sourceIds).not.toContain(stage.id);
    }
    // The copy is independent of the source.
    expect(
      (await pipelineOf(api, owner, source.opening_number)).stages,
    ).toEqual(replacedPipeline.stages);

    const template = await newTemplate(api, owner, "Override", [
      { name: "Check", kind: "background_check" },
    ]);
    const overridden = await api.duplicateOpening(owner, {
      opening_number: source.opening_number,
      pipeline_template_id: template.id,
    });
    expect(overridden.status(), await overridden.text()).toBe(201);
    expect(
      shape(
        (
          await pipelineOf(
            api,
            owner,
            ((await overridden.json()) as OrgOpening).opening_number,
          )
        ).stages,
      ),
    ).toEqual([{ name: "Check", kind: "background_check" }]);

    const before = await (await api.openingSummary(owner)).json();
    await api.deletePipelineTemplate(owner, { template_id: template.id });
    const unknown = await api.duplicateOpening(owner, {
      opening_number: source.opening_number,
      pipeline_template_id: template.id,
    });
    expect(unknown.status(), await unknown.text()).toBe(404);
    expect((await unknown.json()).type).toContain(
      "org-pipeline-template-not-found",
    );
    expect((await (await api.openingSummary(owner)).json()).quota.used).toBe(
      before.quota.used,
    );
  });
});

const unheldID = "01900000-0000-7000-8000-000000000000";

/** The form without ids, to compare with what was sent. */
const asSent = (form: FeedbackCriterion[] | undefined) =>
  (form ?? []).map(({ text, type, required }) => ({ text, type, required }));

function formOf(stage: PipelineStage | PipelineStageDefinition | undefined) {
  const form = stage?.feedback_form;
  if (!form) throw new Error("expected a feedback form");
  return form;
}

async function expectInvalid(
  response: Awaited<ReturnType<Api["replaceOpeningPipeline"]>>,
  fields: string[],
): Promise<void> {
  expect(response.status(), await response.text()).toBe(400);
  expect((await response.json()).fields).toEqual(fields);
}

test("interview stages carry feedback forms through templates, pipelines, and duplicates", async ({
  request,
}) => {
  await withOrg(request, async (api, owner) => {
    const depth = { text: "System design", type: "rating", required: true };
    const fit = { text: "Team fit", type: "yes_no", required: false };
    const extra = { text: "Anything else", type: "text", required: false };
    const created = await newTemplate(api, owner, "Formed", [
      review("Screen"),
      { ...interview("Panel"), feedback_form: [depth, fit] },
      interview("Final"),
    ]);
    // Responses carry a form for every interview stage and only for those.
    expect(created.stages[0]).not.toHaveProperty("feedback_form");
    expect(asSent(formOf(created.stages[1]))).toEqual([depth, fit]);
    expect(created.stages[2]?.feedback_form).toEqual([]);
    const [d, f] = formOf(created.stages[1]) as [
      FeedbackCriterion,
      FeedbackCriterion,
    ];
    expect(d.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);

    // A template keeps ids wherever its criteria move and assigns new ones.
    const updated = await api.updatePipelineTemplate(owner, {
      template_id: created.id,
      name: "Formed",
      stages: [
        review("Screen"),
        { ...interview("Panel"), feedback_form: [f] },
        { ...interview("Final"), feedback_form: [d, extra] },
      ],
    });
    expect(updated.status(), await updated.text()).toBe(200);
    const template = (await updated.json()) as PipelineTemplate;
    expect(formOf(template.stages[1])).toEqual([f]);
    expect(formOf(template.stages[2])[0]).toEqual(d);
    expect(formOf(template.stages[2])[1]?.id).not.toBe(d.id);

    const unheld = { ...depth, id: unheldID };
    await expectInvalid(
      await api.updatePipelineTemplate(owner, {
        template_id: template.id,
        name: "Formed",
        stages: [{ ...interview("Panel"), feedback_form: [unheld] }],
      }),
      ["stages.0.feedback_form.0.id"],
    );
    await expectInvalid(
      await api.createPipelineTemplate(owner, {
        name: "Copied ids",
        stages: [{ ...interview("Panel"), feedback_form: [d] }],
      }),
      ["stages.0.feedback_form.0.id"],
    );
    await expectInvalid(
      await api.createPipelineTemplate(owner, {
        name: "Too many",
        stages: [
          {
            ...interview("Panel"),
            feedback_form: Array.from({ length: 11 }, () => depth),
          },
          { ...review("Screen"), feedback_form: [depth] },
          { ...interview("Final"), feedback_form: [{ ...fit, type: "stars" }] },
        ],
      }),
      [
        "stages.0.feedback_form",
        "stages.1.feedback_form",
        "stages.2.feedback_form.0.type",
      ],
    );

    // An Opening copies the template's forms with their ids, and later
    // template edits leave it alone.
    const opening = await newOpening(api, owner, {
      pipeline_template_id: template.id,
    });
    const copied = await pipelineOf(api, owner, opening.opening_number);
    expect(copied.stages.map((stage) => stage.feedback_form)).toEqual(
      template.stages.map((stage) => stage.feedback_form),
    );
    expect(
      copied.stages.map((stage) => stage.feedback_submitted_count),
    ).toEqual([0, 0, 0]);
    const cleared = await api.updatePipelineTemplate(owner, {
      template_id: template.id,
      name: "Formed",
      stages: [interview("Panel")],
    });
    expect(cleared.status(), await cleared.text()).toBe(200);
    expect(await pipelineOf(api, owner, opening.opening_number)).toEqual(
      copied,
    );

    // Replacing keeps ids through a reorder and assigns new ones; an id is
    // only ever kept by the stage that holds it.
    const screen = stageAt(copied, 0);
    const panel = stageAt(copied, 1);
    const final = stageAt(copied, 2);
    const finalForm = formOf(final);
    const replaced = await api.replaceOpeningPipeline(owner, {
      opening_number: opening.opening_number,
      version: copied.version,
      stages: [
        {
          id: final.id,
          name: final.name,
          kind: "interview",
          feedback_form: [finalForm[1] as FeedbackCriterion, fit],
        },
        { id: screen.id, name: screen.name, kind: "review" },
        { id: panel.id, name: panel.name, kind: "interview" },
      ],
    });
    expect(replaced.status(), await replaced.text()).toBe(200);
    const pipeline = (await replaced.json()) as OpeningPipeline;
    const reordered = formOf(stageAt(pipeline, 0));
    expect(reordered[0]).toEqual(finalForm[1]);
    expect(reordered[1]).toMatchObject({ ...fit, id: expect.any(String) });
    expect(reordered[1]?.id).not.toBe(formOf(panel)[0]?.id);
    expect(stageAt(pipeline, 2).feedback_form).toEqual([]);

    const moved = finalForm[1] as FeedbackCriterion;
    await expectInvalid(
      await api.replaceOpeningPipeline(owner, {
        opening_number: opening.opening_number,
        version: pipeline.version,
        stages: [
          { id: final.id, name: final.name, kind: "interview" },
          { id: screen.id, name: screen.name, kind: "review" },
          {
            id: panel.id,
            name: panel.name,
            kind: "interview",
            feedback_form: [moved],
          },
          { name: "New", kind: "interview", feedback_form: [unheld] },
        ],
      }),
      ["stages.2.feedback_form.0.id", "stages.3.feedback_form.0.id"],
    );
    await expectInvalid(
      await api.replaceOpeningPipeline(owner, {
        opening_number: opening.opening_number,
        version: pipeline.version,
        stages: [
          {
            id: screen.id,
            name: screen.name,
            kind: "review",
            feedback_form: [depth],
          },
          {
            name: "Panel",
            kind: "interview",
            feedback_form: Array.from({ length: 11 }, () => depth),
          },
        ],
      }),
      ["stages.0.feedback_form", "stages.1.feedback_form"],
    );
    expect(await pipelineOf(api, owner, opening.opening_number)).toEqual(
      pipeline,
    );

    // A duplicate copies the source's forms with their ids.
    const duplicated = await api.duplicateOpening(owner, {
      opening_number: opening.opening_number,
    });
    expect(duplicated.status(), await duplicated.text()).toBe(201);
    const duplicate = await pipelineOf(
      api,
      owner,
      ((await duplicated.json()) as OrgOpening).opening_number,
    );
    expect(duplicate.stages.map((stage) => stage.feedback_form)).toEqual(
      pipeline.stages.map((stage) => stage.feedback_form),
    );
  });
});

test("the pipeline counts the feedback submitted on each stage", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  const world: HiringOrg = {
    request,
    tenant: "sgp",
    api,
    owner: "",
    domain: org.domain,
    did: orgDID(org.domain),
    applicants: [],
  };
  try {
    world.owner = await loginOrg(api, org);
    const { opening, stages } = await publishedOpening(api, world.owner, org);
    const number = opening.opening_number;
    const panel = stages[1] as PipelineStage;
    const seeded = await seedApplication(world, number, {
      state: "in_pipeline",
      stageId: panel.id,
    });
    const reference = {
      opening_number: number,
      application_number: seeded.number,
    };
    const scheduled = await api.scheduleInterview(world.owner, {
      ...reference,
      version: seeded.version,
      start_time: new Date(Date.now() + 3_600_000).toISOString(),
      duration_minutes: 45,
      mode: "video",
      video_url: "https://meet.example.com/room",
      interviewer_emails: [org.emailAddress],
    });
    expect(scheduled.status(), await scheduled.text()).toBe(200);
    orgSQL(
      `UPDATE vetchium.org_interviews AS i
       SET starts_at = now() - interval '1 hour'
       FROM vetchium.org_applications AS a
       JOIN vetchium.org_openings AS o USING (org_opening_id)
       WHERE a.org_application_id = i.org_application_id
         AND o.org_did = ${sqlLiteral(world.did)}::uuid
         AND o.opening_number = ${number}
         AND a.application_number = ${seeded.number}`,
      world.tenant,
    );
    const completed = await api.recordInterviewOutcome(world.owner, {
      ...reference,
      version: ((await scheduled.json()) as ApplicationDetail).version,
      interview_number: 1,
      outcome: "completed",
    });
    expect(completed.status(), await completed.text()).toBe(200);
    const submitted = await api.submitInterviewFeedback(world.owner, {
      ...reference,
      version: ((await completed.json()) as ApplicationDetail).version,
      interview_number: 1,
      recommendation: "yes",
      notes: "Solid systems depth",
    });
    expect(submitted.status(), await submitted.text()).toBe(200);
    const pipeline = await pipelineOf(api, world.owner, number);
    expect(
      pipeline.stages.map((stage) => stage.feedback_submitted_count),
    ).toEqual([0, 1, 0]);
  } finally {
    cleanupApplicants(world);
    cleanupOutbox(org.domain);
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("another Org's template is not found", async ({ request }) => {
  const apiA = new OrgsAPI(request);
  const orgA = await signupOrg(apiA);
  const orgB = await signupOrg(apiA);
  try {
    const tokenA = await loginOrg(apiA, orgA);
    const tokenB = await loginOrg(apiA, orgB);
    const foreign = await newTemplate(apiA, tokenB, "Foreign");
    const opening = await newOpening(apiA, tokenA);
    const create = await apiA.createOpening(tokenA, {
      content: { title: "Borrowed" },
      team_member_emails: [],
      pipeline_template_id: foreign.id,
    });
    expect(create.status(), await create.text()).toBe(404);
    const duplicate = await apiA.duplicateOpening(tokenA, {
      opening_number: opening.opening_number,
      pipeline_template_id: foreign.id,
    });
    expect(duplicate.status(), await duplicate.text()).toBe(404);
    const update = await apiA.updatePipelineTemplate(tokenA, {
      template_id: foreign.id,
      name: "Stolen",
      stages: [review("Screen")],
    });
    expect(update.status(), await update.text()).toBe(404);
    const remove = await apiA.deletePipelineTemplate(tokenA, {
      template_id: foreign.id,
    });
    expect(remove.status(), await remove.text()).toBe(404);
    expect(
      (await (await apiA.listPipelineTemplates(tokenB)).json()).templates,
    ).toEqual([foreign]);
    expect(
      (await (await apiA.listPipelineTemplates(tokenA)).json()).templates,
    ).toEqual([]);
  } finally {
    await deleteOrgVerificationRecord(orgA.domain);
    await deleteOrgVerificationRecord(orgB.domain);
    cleanupOrg(orgA.domain);
    cleanupOrg(orgB.domain);
  }
});

test("replacing an Opening's pipeline keeps stage ids and records history", async ({
  request,
}) => {
  await withOrg(request, async (api, owner) => {
    const template = await newTemplate(api, owner, "Three", [
      review("One"),
      review("Two"),
      interview("Three"),
    ]);
    const opening = await newOpening(api, owner, {
      pipeline_template_id: template.id,
    });
    const initial = await pipelineOf(api, owner, opening.opening_number);
    const one = stageAt(initial, 0);
    const two = stageAt(initial, 1);
    const three = stageAt(initial, 2);

    const key = orgsIdempotencyKey();
    const body: ReplaceOpeningPipelineRequest = {
      opening_number: opening.opening_number,
      version: initial.version,
      stages: [
        { id: three.id, name: "Three, first now", kind: "interview" },
        { name: "Brand new", kind: "assessment" },
        { id: one.id, name: "One", kind: "review" },
      ],
    };
    const response = await api.replaceOpeningPipeline(owner, body, key);
    expect(response.status(), await response.text()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const replaced = (await response.json()) as OpeningPipeline;
    expect(replaced.version).toBe(initial.version + 1);
    expect(shape(replaced.stages)).toEqual([
      { name: "Three, first now", kind: "interview" },
      { name: "Brand new", kind: "assessment" },
      { name: "One", kind: "review" },
    ]);
    expect(stageAt(replaced, 0).id).toBe(three.id);
    expect(stageAt(replaced, 2).id).toBe(one.id);
    expect(replaced.stages.map((stage) => stage.id)).not.toContain(two.id);
    expect(new Set(replaced.stages.map((stage) => stage.id)).size).toBe(3);
    expect(await pipelineOf(api, owner, opening.opening_number)).toEqual(
      replaced,
    );

    const replay = await api.replaceOpeningPipeline(owner, body, key);
    expect(replay.status(), await replay.text()).toBe(200);
    expect(await replay.json()).toEqual(replaced);
    expect(orgAuditEventsByKey(key)).toHaveLength(1);
    expect(JSON.stringify(orgAuditEventsByKey(key))).not.toContain("Brand new");
    const keyConflict = await api.replaceOpeningPipeline(
      owner,
      { ...body, stages: [review("Different")] },
      key,
    );
    expect(keyConflict.status(), await keyConflict.text()).toBe(409);
    expect((await keyConflict.json()).type).toContain(
      "idempotency-key-conflict",
    );

    // The Opening's own version moved with the pipeline.
    const detail = await api.getOpening(owner, {
      opening_number: opening.opening_number,
    });
    expect(((await detail.json()) as OrgOpening).version).toBe(
      replaced.version,
    );
    const history = await api.listOpeningHistory(owner, {
      opening_number: opening.opening_number,
    });
    expect((await history.json()).entries[0]).toMatchObject({
      action: "pipeline_changed",
      version: replaced.version,
      actor_email: expect.any(String),
    });

    // A shrink to a single stage removes the others.
    const shrunk = await api.replaceOpeningPipeline(owner, {
      opening_number: opening.opening_number,
      version: replaced.version,
      stages: [{ id: one.id, name: "Only", kind: "review" }],
    });
    expect(shrunk.status(), await shrunk.text()).toBe(200);
    expect(shape(((await shrunk.json()) as OpeningPipeline).stages)).toEqual([
      { name: "Only", kind: "review" },
    ]);
  });
});

test("replacing a pipeline refuses stale versions, foreign ids, and bad lists", async ({
  request,
}) => {
  await withOrg(request, async (api, owner) => {
    const first = await newOpening(api, owner);
    const second = await newOpening(api, owner);
    const firstPipeline = await pipelineOf(api, owner, first.opening_number);
    const secondPipeline = await pipelineOf(api, owner, second.opening_number);

    const stale = await api.replaceOpeningPipeline(owner, {
      opening_number: first.opening_number,
      version: firstPipeline.version + 5,
      stages: [review("Screen")],
    });
    expect(stale.status(), await stale.text()).toBe(409);
    expect((await stale.json()).type).toContain("org-opening-version-conflict");

    // An id that belongs to another Opening is refused, and nothing changes.
    const foreign = await api.replaceOpeningPipeline(owner, {
      opening_number: first.opening_number,
      version: firstPipeline.version,
      stages: [
        { id: stageAt(firstPipeline, 0).id, name: "Kept", kind: "review" },
        { id: stageAt(secondPipeline, 0).id, name: "Taken", kind: "review" },
      ],
    });
    expect(foreign.status(), await foreign.text()).toBe(400);
    expect(await foreign.json()).toMatchObject({
      type: expect.stringContaining("validation-failed"),
      fields: ["stages.1.id"],
    });
    expect(await pipelineOf(api, owner, first.opening_number)).toEqual(
      firstPipeline,
    );
    expect(await pipelineOf(api, owner, second.opening_number)).toEqual(
      secondPipeline,
    );

    // An id nobody ever issued.
    const invented = await api.replaceOpeningPipeline(owner, {
      opening_number: first.opening_number,
      version: firstPipeline.version,
      stages: [
        {
          id: "01900000-0000-7000-8000-000000000000",
          name: "Invented",
          kind: "review",
        },
      ],
    });
    expect(invented.status(), await invented.text()).toBe(400);
    expect((await invented.json()).fields).toEqual(["stages.0.id"]);

    // A stale caller learns about the version, not the missing id.
    const staleInvented = await api.replaceOpeningPipeline(owner, {
      opening_number: first.opening_number,
      version: firstPipeline.version + 1,
      stages: [
        {
          id: "01900000-0000-7000-8000-000000000000",
          name: "Invented",
          kind: "review",
        },
      ],
    });
    expect(staleInvented.status()).toBe(409);

    const id = stageAt(firstPipeline, 0).id;
    const duplicateIds = await api.replaceOpeningPipeline(owner, {
      opening_number: first.opening_number,
      version: firstPipeline.version,
      stages: [
        { id, name: "A", kind: "review" },
        { id, name: "B", kind: "review" },
      ],
    });
    expect(duplicateIds.status(), await duplicateIds.text()).toBe(400);
    expect((await duplicateIds.json()).fields).toEqual(["stages.1.id"]);

    const sixteen = await api.replaceOpeningPipeline(owner, {
      opening_number: first.opening_number,
      version: firstPipeline.version,
      stages: Array.from({ length: 16 }, (_, index) => review(`S${index}`)),
    });
    expect(sixteen.status()).toBe(400);
    expect((await sixteen.json()).fields).toEqual(["stages"]);
    const empty = await api.replaceOpeningPipeline(owner, {
      opening_number: first.opening_number,
      version: firstPipeline.version,
      stages: [],
    });
    expect(empty.status()).toBe(400);
    const fifteen = await api.replaceOpeningPipeline(owner, {
      opening_number: first.opening_number,
      version: firstPipeline.version,
      stages: Array.from({ length: 15 }, (_, index) => review(`S${index}`)),
    });
    expect(fifteen.status(), await fifteen.text()).toBe(200);
    expect(((await fifteen.json()) as OpeningPipeline).stages).toHaveLength(15);
  });
});

test("concurrent pipeline replacements apply once", async ({ request }) => {
  await withOrg(request, async (api, owner) => {
    const opening = await newOpening(api, owner);
    const { version } = await pipelineOf(api, owner, opening.opening_number);
    const results = await Promise.all(
      ["A", "B", "C"].map((name) =>
        api.replaceOpeningPipeline(owner, {
          opening_number: opening.opening_number,
          version,
          stages: [review(name)],
        }),
      ),
    );
    expect(results.map((response) => response.status()).sort()).toEqual([
      200, 409, 409,
    ]);
    expect((await pipelineOf(api, owner, opening.opening_number)).version).toBe(
      version + 1,
    );
  });
});

test("a pipeline is editable in every live state and read in terminal ones", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const opening = await fullOpening(api, owner, org);
    const number = opening.opening_number;
    for (const [state, kind] of [
      ["published", "publish"],
      ["paused", "pause"],
    ] as const) {
      await changeOpening(api, owner, number, kind);
      const response = await api.replaceOpeningPipeline(owner, {
        opening_number: number,
        version: (await pipelineOf(api, owner, number)).version,
        stages: [review(`In ${state}`)],
      });
      expect(response.status(), await response.text()).toBe(200);
    }

    // Closing, and an expiry once the expiry date passed, end the Opening.
    const expiring = await fullOpening(api, owner, org);
    await changeOpening(api, owner, expiring.opening_number, "publish");
    orgSQL(`UPDATE vetchium.org_openings SET
      created_at = now() - interval '182 days',
      first_published_at = now() - interval '181 days',
      expires_at = now() - interval '1 day'
      WHERE org_did = (SELECT org_did FROM vetchium.org_domains
        WHERE domain = '${org.domain}')
        AND opening_number = ${expiring.opening_number}`);
    await changeOpening(api, owner, number, "close");
    await expect
      .poll(
        async () =>
          (
            (await (
              await api.getOpening(owner, {
                opening_number: expiring.opening_number,
              })
            ).json()) as OrgOpening
          ).state,
        { timeout: 15_000 },
      )
      .toBe("expired");
    for (const ended of [number, expiring.opening_number]) {
      const refused = await api.replaceOpeningPipeline(owner, {
        opening_number: ended,
        version: (await pipelineOf(api, owner, ended)).version,
        stages: [review("Too late")],
      });
      expect(refused.status(), await refused.text()).toBe(409);
      expect((await refused.json()).type).toContain(
        "org-opening-state-conflict",
      );
    }
    expect(shape((await pipelineOf(api, owner, number)).stages)).toEqual([
      { name: "In paused", kind: "review" },
    ]);
  });
});

test("a pending request does not block a pipeline edit", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const created = await api.createOpening(manager.token, {
      content: {
        title: "Engineer",
        description: "Build reliable services",
        language: "en",
        employing_country: "SG",
        work_arrangement: "on_site",
        employment_type: "full_time",
        positions: 1,
      },
      hiring_manager_email: manager.emailAddress,
      recruiter_email: manager.emailAddress,
      team_member_emails: [],
    });
    expect(created.status(), await created.text()).toBe(201);
    const opening = (await created.json()) as OrgOpening;
    const requested = await api.requestOpeningChange(manager.token, {
      opening_number: opening.opening_number,
      version: opening.version,
      kind: "publish",
    });
    expect(requested.status(), await requested.text()).toBe(200);
    const pending = (await requested.json()) as OrgOpening;
    expect(pending.pending_request).toMatchObject({ kind: "publish" });

    const replaced = await api.replaceOpeningPipeline(manager.token, {
      opening_number: opening.opening_number,
      version: pending.version,
      stages: [review("Screen"), interview("Panel")],
    });
    expect(replaced.status(), await replaced.text()).toBe(200);
  });
});

test("a discarded Opening has no pipeline", async ({ request }) => {
  await withOrg(request, async (api, owner) => {
    const opening = await newOpening(api, owner);
    const discarded = await api.discardOpening(owner, {
      opening_number: opening.opening_number,
      version: opening.version,
    });
    expect(discarded.status(), await discarded.text()).toBe(200);
    const read = await api.getOpeningPipeline(owner, {
      opening_number: opening.opening_number,
    });
    expect(read.status(), await read.text()).toBe(409);
    expect((await read.json()).type).toContain("org-opening-state-conflict");
    const write = await api.replaceOpeningPipeline(owner, {
      opening_number: opening.opening_number,
      version: opening.version + 1,
      stages: [review("Nope")],
    });
    expect(write.status(), await write.text()).toBe(409);
    expect((await write.json()).type).toContain("org-opening-state-conflict");
  });
});

test("pipeline routes need org:manage_openings", async ({ request }) => {
  await withOrg(request, async (api, owner, org) => {
    const opening = await newOpening(api, owner);
    const template = await newTemplate(api, owner, "Visible");
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const viewer = await addOrgMember(
      api,
      owner,
      org.domain,
      `viewer@${org.domain}`,
      ["org:view_openings"],
    );
    const approver = await addOrgMember(
      api,
      owner,
      org.domain,
      `approver@${org.domain}`,
      ["org:approve_openings"],
    );
    // A hiring manager and recruiter without a grant act on applications,
    // not on the pipeline (HP-AUTH-005).
    const named = await addOrgMember(
      api,
      owner,
      org.domain,
      `named@${org.domain}`,
    );
    const team = await api.setOpeningTeam(owner, {
      opening_number: opening.opening_number,
      version: opening.version,
      hiring_manager_email: named.emailAddress,
      recruiter_email: named.emailAddress,
      team_member_emails: [],
    });
    expect(team.status(), await team.text()).toBe(200);

    const number = opening.opening_number;
    const routes: { path: string; body: object; write: boolean }[] = [
      { path: "/list-pipeline-templates", body: {}, write: false },
      {
        path: "/create-pipeline-template",
        body: { name: "Denied", stages: [review("Screen")] },
        write: true,
      },
      {
        path: "/update-pipeline-template",
        body: {
          template_id: template.id,
          name: "Denied",
          stages: [review("Screen")],
        },
        write: true,
      },
      {
        path: "/delete-pipeline-template",
        body: { template_id: template.id },
        write: true,
      },
      {
        path: "/get-opening-pipeline",
        body: { opening_number: number },
        write: false,
      },
      {
        path: "/replace-opening-pipeline",
        body: {
          opening_number: number,
          version: 100,
          stages: [review("Denied")],
        },
        write: true,
      },
    ];
    for (const denied of [viewer, approver, named]) {
      for (const route of routes) {
        const response = await api.post(route.path, route.body, {
          token: denied.token,
          ...(route.write ? { idempotencyKey: orgsIdempotencyKey() } : {}),
        });
        expect(
          response.status(),
          `${denied.emailAddress} ${route.path}: ${await response.text()}`,
        ).toBe(403);
        expect((await response.json()).type).toContain(
          "org-permission-required",
        );
      }
    }
    // Nothing was changed by the refused calls.
    expect(
      (await (await api.listPipelineTemplates(owner)).json()).templates,
    ).toEqual([template]);

    // The holder of the permission, with no other grant, may use every route.
    const listed = await api.listPipelineTemplates(manager.token);
    expect(listed.status(), await listed.text()).toBe(200);
    const read = await pipelineOf(api, manager.token, number);
    const replaced = await api.replaceOpeningPipeline(manager.token, {
      opening_number: number,
      version: read.version,
      stages: [review("By manager")],
    });
    expect(replaced.status(), await replaced.text()).toBe(200);
    const created = await newTemplate(api, manager.token, "Manager's");
    const updated = await api.updatePipelineTemplate(manager.token, {
      template_id: created.id,
      name: "Manager's renamed",
      stages: [review("Screen")],
    });
    expect(updated.status(), await updated.text()).toBe(200);
    const deleted = await api.deletePipelineTemplate(manager.token, {
      template_id: created.id,
    });
    expect(deleted.status(), await deleted.text()).toBe(204);
  });
});

test("pipeline routes authenticate, validate, and refuse suspended Orgs", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const opening = await newOpening(api, owner);
    const template = await newTemplate(api, owner, "Present");
    const number = opening.opening_number;
    const routes: { path: string; body: object; write: boolean }[] = [
      { path: "/list-pipeline-templates", body: {}, write: false },
      {
        path: "/create-pipeline-template",
        body: { name: "New", stages: [review("Screen")] },
        write: true,
      },
      {
        path: "/update-pipeline-template",
        body: {
          template_id: template.id,
          name: "Renamed",
          stages: [review("Screen")],
        },
        write: true,
      },
      {
        path: "/delete-pipeline-template",
        body: { template_id: template.id },
        write: true,
      },
      {
        path: "/get-opening-pipeline",
        body: { opening_number: number },
        write: false,
      },
      {
        path: "/replace-opening-pipeline",
        body: {
          opening_number: number,
          version: opening.version,
          stages: [review("Screen")],
        },
        write: true,
      },
    ];
    for (const route of routes) {
      const unauthenticated = await api.post(route.path, route.body, {
        ...(route.write ? { idempotencyKey: orgsIdempotencyKey() } : {}),
      });
      expect(
        unauthenticated.status(),
        `${route.path}: ${await unauthenticated.text()}`,
      ).toBe(401);
      const malformed = await api.postRaw(route.path, "{", {
        token: owner,
        ...(route.write ? { idempotencyKey: orgsIdempotencyKey() } : {}),
      });
      expect(
        malformed.status(),
        `${route.path}: ${await malformed.text()}`,
      ).toBe(400);
      expect((await malformed.json()).type).toContain("invalid-json");
    }
    for (const route of routes.filter((item) => item.write)) {
      const missingKey = await api.post(route.path, route.body, {
        token: owner,
      });
      expect(
        missingKey.status(),
        `${route.path}: ${await missingKey.text()}`,
      ).toBe(400);
    }

    const invalidBodies: { path: string; body: object; write: boolean }[] = [
      {
        path: "/list-pipeline-templates",
        body: { limit: 0 },
        write: false,
      },
      {
        path: "/create-pipeline-template",
        body: { name: "", stages: [] },
        write: true,
      },
      {
        path: "/update-pipeline-template",
        body: { template_id: "not-a-uuid", name: "x", stages: [] },
        write: true,
      },
      {
        path: "/delete-pipeline-template",
        body: { template_id: "NOT-LOWERCASE" },
        write: true,
      },
      {
        path: "/get-opening-pipeline",
        body: { opening_number: 0 },
        write: false,
      },
      {
        path: "/replace-opening-pipeline",
        body: { opening_number: number, version: 0, stages: [] },
        write: true,
      },
      {
        path: "/create-opening",
        body: {
          content: {},
          team_member_emails: [],
          pipeline_template_id: "nope",
        },
        write: true,
      },
      {
        path: "/duplicate-opening",
        body: { opening_number: number, pipeline_template_id: "nope" },
        write: true,
      },
    ];
    for (const route of invalidBodies) {
      const invalid = await api.post(route.path, route.body, {
        token: owner,
        ...(route.write ? { idempotencyKey: orgsIdempotencyKey() } : {}),
      });
      expect(invalid.status(), `${route.path}: ${await invalid.text()}`).toBe(
        400,
      );
      expect((await invalid.json()).type).toContain("validation-failed");
    }

    const absent = await api.getOpeningPipeline(owner, {
      opening_number: 999,
    });
    expect(absent.status(), await absent.text()).toBe(404);
    expect((await absent.json()).type).toContain("org-opening-not-found");
    const absentReplace = await api.replaceOpeningPipeline(owner, {
      opening_number: 999,
      version: 1,
      stages: [review("Screen")],
    });
    expect(absentReplace.status(), await absentReplace.text()).toBe(404);

    orgSQL(`UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
      WHERE org_did = (SELECT org_did FROM vetchium.org_domains
        WHERE domain = '${org.domain}')`);
    for (const route of routes) {
      const blocked = await api.post(route.path, route.body, {
        token: owner,
        ...(route.write ? { idempotencyKey: orgsIdempotencyKey() } : {}),
      });
      expect(blocked.status(), `${route.path}: ${await blocked.text()}`).toBe(
        403,
      );
      expect((await blocked.json()).type).toContain("org-suspended");
    }
  });
});
