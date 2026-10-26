import type { Page } from "@playwright/test";
import type {
  PipelineStage,
  PipelineTemplate,
} from "typespec/orgs/hiring/pipelines";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { expect, test } from "../lib/admin-fixtures.ts";
import { seedApplication } from "../lib/hiring-seed.ts";
import { addOrgMember, type OrgsAPI } from "../lib/orgs-api.ts";
import { openingContent } from "../lib/orgs-applications.ts";
import { signIn, withOrg } from "../lib/orgs-ui.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";

test.describe.configure({ timeout: 90_000 });

async function createTemplate(
  api: OrgsAPI,
  token: string,
  name: string,
  stages: PipelineTemplate["stages"],
): Promise<PipelineTemplate> {
  const response = await api.createPipelineTemplate(token, { name, stages });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as PipelineTemplate;
}

async function createOpening(
  api: OrgsAPI,
  token: string,
  templateID?: string,
): Promise<OrgOpening> {
  const response = await api.createOpening(token, {
    content: { title: "Pipeline engineer" },
    team_member_emails: [],
    ...(templateID !== undefined && { pipeline_template_id: templateID }),
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as OrgOpening;
}

async function pipelineOf(api: OrgsAPI, token: string, number: number) {
  const response = await api.getOpeningPipeline(token, {
    opening_number: number,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as {
    version: number;
    stages: PipelineStage[];
  };
}

async function chooseKind(page: Page, stage: number, kind: string) {
  await page.getByRole("combobox", { name: `Stage ${stage} kind` }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByTitle(kind, { exact: true })
    .click();
}

test("create, edit, and delete a pipeline template", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org) => {
    await signIn(page, org);
    await page.getByRole("menuitem", { name: /Pipeline templates$/ }).click();
    await expect(page).toHaveURL(/\/pipeline-templates$/);
    await expect(
      page.getByRole("heading", { name: "Pipeline templates", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("No pipeline templates yet.")).toBeVisible();
    await expect(page.getByText("0 of 50 templates")).toBeVisible();

    await page.getByRole("button", { name: "New template" }).first().click();
    const drawer = page.getByRole("dialog");
    await expect(
      drawer.getByText("Enter a template name of 1 to 100 characters."),
    ).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: "Save template" }),
    ).toBeDisabled();
    await drawer
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Design hiring");
    await drawer
      .getByRole("textbox", { name: "Stage 1 name" })
      .fill("Portfolio review");
    await drawer.getByRole("button", { name: "Add stage" }).click();
    await drawer
      .getByRole("textbox", { name: "Stage 2 name" })
      .fill("Exercise");
    await chooseKind(page, 2, "Assessment");
    await drawer.getByRole("button", { name: "Add stage" }).click();
    await drawer.getByRole("textbox", { name: "Stage 3 name" }).fill("Panel");
    await chooseKind(page, 3, "Interview");
    await drawer.getByRole("button", { name: "Move stage 3 up" }).click();
    await expect(
      drawer.getByRole("textbox", { name: "Stage 2 name" }),
    ).toHaveValue("Panel");
    await drawer.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const row = page.getByRole("row").filter({ hasText: "Design hiring" });
    await expect(row.getByText("1. Portfolio review")).toBeVisible();
    await expect(row.getByText("2. Panel")).toBeVisible();
    await expect(row.getByText("3. Exercise")).toBeVisible();
    await expect(page.getByText("1 of 50 templates")).toBeVisible();

    await row
      .getByRole("button", { name: "Edit template Design hiring" })
      .click();
    const editor = page.getByRole("dialog");
    await editor
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Design hiring v2");
    await editor.getByRole("button", { name: "Remove stage 2" }).click();
    await editor.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const renamed = page
      .getByRole("row")
      .filter({ hasText: "Design hiring v2" });
    await expect(renamed.getByText("2. Exercise")).toBeVisible();
    await expect(renamed.getByText("3.")).toHaveCount(0);

    await page.getByRole("searchbox", { name: "Search name" }).fill("nothing");
    await expect(
      page.getByText("No template matches this search."),
    ).toBeVisible();
    await page.getByRole("searchbox", { name: "Search name" }).fill("");

    await renamed
      .getByRole("button", { name: "Delete template Design hiring v2" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(page.getByText("No pipeline templates yet.")).toBeVisible();
  });
});

test("a template name already taken is refused beside the name, and edits are guarded", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    await createTemplate(api, owner, "Sales", [
      { name: "Review", kind: "review" },
    ]);
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/pipeline-templates`);
    await page.getByRole("button", { name: "New template" }).click();
    const drawer = page.getByRole("dialog");
    await drawer
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("sales");
    await drawer.getByRole("textbox", { name: "Stage 1 name" }).fill("Look");
    await expect(drawer.getByText("Unsaved changes")).toBeVisible();
    await drawer.getByRole("button", { name: "Save template" }).click();
    await expect(
      drawer.getByText("Another template already has this name."),
    ).toBeVisible();

    // Cancelling with edits asks first; staying keeps them.
    await drawer.getByRole("button", { name: "Cancel" }).click();
    await page
      .getByRole("dialog")
      .filter({ hasText: "Leave without saving?" })
      .getByRole("button", { name: "Stay" })
      .click();
    await expect(
      drawer.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("sales");
    await drawer.getByRole("button", { name: "Cancel" }).click();
    await page
      .getByRole("dialog")
      .filter({ hasText: "Leave without saving?" })
      .getByRole("button", { name: "Leave" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test("a new Opening starts from a chosen template and keeps its own copy", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const template = await createTemplate(api, owner, "Design hiring", [
      { name: "Portfolio review", kind: "review" },
      { name: "Design panel", kind: "interview" },
    ]);
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/new`);
    await expect(page.getByText("One review stage")).toBeVisible();
    await page.getByRole("combobox", { name: "Start from" }).click();
    await page
      .locator(".ant-select-dropdown:visible")
      .getByTitle("Design hiring · 2 stages")
      .click();
    await expect(page.getByText("2. Design panel")).toBeVisible();
    await page.getByRole("textbox", { name: "Title" }).fill("Designer");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/openings\/1$/);
    await page.getByRole("tab", { name: "Pipeline" }).click();
    await expect(
      page.getByRole("textbox", { name: "Stage 1 name" }),
    ).toHaveValue("Portfolio review");
    await expect(
      page.getByRole("textbox", { name: "Stage 2 name" }),
    ).toHaveValue("Design panel");

    // Editing the template later never changes the Opening.
    const updated = await api.updatePipelineTemplate(owner, {
      template_id: template.id,
      name: "Design hiring",
      stages: [{ name: "Only", kind: "review" }],
    });
    expect(updated.status()).toBe(200);
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Stage 2 name" }),
    ).toHaveValue("Design panel");
  });
});

test("the Pipeline tab edits stages, keeps its tab in the URL, and guards unsaved changes", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const opening = await createOpening(api, owner);
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/${opening.opening_number}`);
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "Pipeline" }).click();
    await expect(page).toHaveURL(/\/openings\/1\?tab=pipeline$/);
    await page.reload();
    await expect(page.getByRole("tab", { name: "Pipeline" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByRole("textbox", { name: "Stage 1 name" }),
    ).toHaveValue("Review");
    await expect(
      page.getByRole("button", { name: "Save pipeline" }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Offer accepted", { exact: true }),
    ).toBeVisible();

    await page.getByRole("textbox", { name: "Stage 1 name" }).fill("Screen");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await page.getByRole("button", { name: "Add stage" }).click();
    await page.getByRole("textbox", { name: "Stage 2 name" }).fill("Panel");
    await chooseKind(page, 2, "Interview");

    // Leaving for another page asks first; staying keeps the edits.
    await page.getByRole("menuitem", { name: /Openings$/ }).click();
    const leave = page
      .getByRole("dialog")
      .filter({ hasText: "Leave without saving?" });
    await expect(leave).toBeVisible();
    await leave.getByRole("button", { name: "Stay" }).click();
    await expect(
      page.getByRole("textbox", { name: "Stage 2 name" }),
    ).toHaveValue("Panel");

    // Switching tabs keeps the edits too.
    await page.getByRole("tab", { name: "Overview" }).click();
    await page.getByRole("tab", { name: "Pipeline" }).click();
    await expect(
      page.getByRole("textbox", { name: "Stage 2 name" }),
    ).toHaveValue("Panel");

    await page.getByRole("button", { name: "Move stage 2 up" }).click();
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Stage 2 name" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Stage 1 name" }),
    ).toHaveValue("Review");

    await page.getByRole("textbox", { name: "Stage 1 name" }).fill("Screen");
    await page.getByRole("button", { name: "Add stage" }).click();
    await page.getByRole("textbox", { name: "Stage 2 name" }).fill("Panel");
    await chooseKind(page, 2, "Interview");
    await page.getByRole("button", { name: "Move stage 2 up" }).click();
    await page.getByRole("button", { name: "Save pipeline" }).click();
    await expect(page.getByText("Pipeline saved.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save pipeline" }),
    ).toHaveCount(0);
    const saved = await pipelineOf(api, owner, opening.opening_number);
    expect(saved.stages.map((stage) => [stage.name, stage.kind])).toEqual([
      ["Panel", "interview"],
      ["Screen", "review"],
    ]);
    // A stored stage keeps its kind.
    await expect(
      page.getByRole("combobox", { name: "Stage 1 kind" }),
    ).toBeDisabled();

    // A blank name says why saving is unavailable.
    await page.getByRole("textbox", { name: "Stage 1 name" }).fill(" ");
    await expect(
      page.getByText("Give every stage a name of 1 to 100 characters."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save pipeline" }),
    ).toBeDisabled();
  });
});

test("removing a stage that holds a candidate is explained beside the stage", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const template = await createTemplate(api, owner, "Two stages", [
      { name: "Screen", kind: "review" },
      { name: "Panel", kind: "interview" },
    ]);
    const created = await api.createOpening(owner, {
      content: openingContent("Pipeline engineer"),
      hiring_manager_email: org.emailAddress,
      recruiter_email: org.emailAddress,
      team_member_emails: [],
      pipeline_template_id: template.id,
    });
    expect(created.status(), await created.text()).toBe(201);
    const opening = (await created.json()) as OrgOpening;
    const published = await api.requestOpeningChange(owner, {
      opening_number: opening.opening_number,
      version: opening.version,
      kind: "publish",
    });
    expect(published.status(), await published.text()).toBe(200);
    const before = await pipelineOf(api, owner, opening.opening_number);
    const panel = before.stages[1];
    if (!panel) throw new Error("expected two stages");
    await seedApplication(world, opening.opening_number, {
      state: "in_pipeline",
      stageId: panel.id,
    });

    await signIn(page, org);
    await page.goto(
      `${ORGS_PORTAL}/openings/${opening.opening_number}?tab=pipeline`,
    );
    await expect(page.getByText(/1 candidate/)).toBeVisible();
    await page.getByRole("button", { name: "Remove stage 2" }).click();
    await expect(
      page.getByText(/Removing “Panel” will be refused/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save pipeline" }).click();
    await expect(
      page.getByText(/Some stages you removed hold candidates/),
    ).toBeVisible();
    expect(
      (await pipelineOf(api, owner, opening.opening_number)).stages,
    ).toHaveLength(2);

    // Restoring the stage clears the problem; renaming it is allowed.
    await page.getByRole("button", { name: "Restore stage Panel" }).click();
    await page.getByRole("textbox", { name: "Stage 2 name" }).fill("Panel 2");
    await page.getByRole("button", { name: "Save pipeline" }).click();
    await expect(page.getByText("Pipeline saved.")).toBeVisible();
    const after = await pipelineOf(api, owner, opening.opening_number);
    expect(after.stages[1]).toMatchObject({ id: panel.id, name: "Panel 2" });
  });
});

test("members without Opening management see neither templates nor the Pipeline tab", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const reader = await addOrgMember(
      api,
      owner,
      org.domain,
      `reader@${org.domain}`,
      [],
    );
    const created = await api.createOpening(owner, {
      content: { title: "Team only" },
      hiring_manager_email: reader.emailAddress,
      team_member_emails: [],
    });
    expect(created.status()).toBe(201);
    await signIn(page, reader);
    await expect(
      page.getByRole("menuitem", { name: /Openings$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /Pipeline templates$/ }),
    ).toHaveCount(0);
    await page.goto(`${ORGS_PORTAL}/pipeline-templates`);
    await expect(page).not.toHaveURL(/pipeline-templates/);
    await page.goto(`${ORGS_PORTAL}/openings/1?tab=pipeline`);
    await expect(
      page.getByRole("heading", { name: /Team only/, level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Pipeline" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
