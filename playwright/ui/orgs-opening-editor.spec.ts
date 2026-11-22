import type { APIRequestContext, Page, Route } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type { AIOptions, DraftOpeningResponse } from "typespec/orgs/ai/ai";
import type {
  SaveOpeningWorkingCopyRequest,
  SetOpeningTeamRequest,
} from "typespec/orgs/openings/openings";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { InternalServerError } from "typespec/problem/details";
import { expect, test } from "../lib/admin-fixtures.ts";
import { addOrgMember, type OrgMember, type OrgsAPI } from "../lib/orgs-api.ts";
import {
  openEditorStep,
  sidebarPage,
  signIn,
  withOrg,
} from "../lib/orgs-ui.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";
import { chooseOption, searchAndChooseOption } from "../lib/region-ui.ts";

test.describe.configure({ timeout: 90_000 });

const storedContent: OpeningContent = {
  title: "Stored engineer",
  description: "Build reliable services",
  language: "en",
  employing_country: "SG",
  work_arrangement: "on_site",
  location_details: "Stored office",
  employment_type: "full_time",
  positions: 1,
};
const versionConflict =
  "This Opening changed. Its latest version has been loaded; review it and try again.";
const savedButForTyping =
  "Saved, except what you changed while saving. Save again to keep those changes.";
const teamStep = "Hiring team and notes";

interface Editing {
  api: OrgsAPI;
  owner: string;
  colleague: OrgMember;
  ownerEmail: string;
  unknownEmail: string;
  created: OrgOpening;
  read: (number?: number) => Promise<OrgOpening>;
}

/** Opens the editor of a complete draft as its owner, with a colleague who
 * manages Openings too. */
async function withEditor(
  page: Page,
  request: APIRequestContext,
  body: (editing: Editing) => Promise<void>,
) {
  await withOrg(request, async (org, api, owner) => {
    const colleague = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const created = await api.createOpening(owner, {
      content: storedContent,
      hiring_manager_email: org.emailAddress,
      recruiter_email: org.emailAddress,
      team_member_emails: [],
      internal_notes: "Stored note",
    });
    expect(created.status(), await created.text()).toBe(201);
    // Lets a test age the query cache past its stale time.
    await page.clock.install();
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/1/edit`);
    await expect(fields(page).title).toHaveValue("Stored engineer");
    await body({
      api,
      owner,
      colleague,
      ownerEmail: org.emailAddress,
      unknownEmail: `unknown@${org.domain}`,
      created: (await created.json()) as OrgOpening,
      read: async (number = 1) => {
        const response = await api.getOpening(owner, {
          opening_number: number,
        });
        expect(response.status()).toBe(200);
        return (await response.json()) as OrgOpening;
      },
    });
  });
}

function fields(page: Page) {
  return {
    title: page.getByRole("textbox", { name: "Title" }),
    description: page.getByRole("textbox", { name: "Description" }),
    location: page.getByRole("textbox", { name: "Location details" }),
    manager: page.getByRole("combobox", { name: "Hiring manager" }),
    recruiter: page.getByRole("combobox", { name: "Recruiter" }),
    members: page.getByRole("combobox", { name: "Team members" }),
    notes: page.getByRole("textbox", { name: "Internal notes" }),
    question: page.getByRole("textbox", { name: "Question", exact: true }),
    save: page.getByRole("button", { name: "Save", exact: true }),
    publish: page.getByRole("button", {
      name: "Save and publish",
      exact: true,
    }),
  };
}

interface Sent<Body> {
  key: string | undefined;
  body: Body;
}

/** Every write the page sends, in order. */
function recordWrites(page: Page) {
  const sent = {
    content: [] as Sent<SaveOpeningWorkingCopyRequest>[],
    team: [] as Sent<SetOpeningTeamRequest>[],
    publication: [] as Sent<unknown>[],
  };
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    const key = request.headers()["idempotency-key"];
    if (path.endsWith("/save-opening-working-copy"))
      sent.content.push({ key, body: request.postDataJSON() });
    else if (path.endsWith("/set-opening-team"))
      sent.team.push({ key, body: request.postDataJSON() });
    else if (path.endsWith("/request-opening-change"))
      sent.publication.push({ key, body: request.postDataJSON() });
  });
  return sent;
}

/** Waits until React has rendered what the last response carried. */
async function rendered(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        setTimeout(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
      ),
  );
}

/** Reconnects a page whose Opening is stale, so that it reads it again; a
 * failing read is retried once. */
async function refetchOpening(page: Page, reads = 1) {
  let seen = 0;
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/orgs/get-opening") &&
      ++seen === reads,
  );
  await page.clock.fastForward(31_000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await (await answered).finished();
  await rendered(page);
}

/** Two real writes: content without its description and location, then a
 * team without its recruiter. */
async function colleagueWrites({ api, colleague, read }: Editing) {
  const before = await read();
  const { description, location_details, ...kept } = storedContent;
  const content = await api.saveOpeningWorkingCopy(colleague.token, {
    opening_number: 1,
    version: before.version,
    content: { ...kept, title: "Colleague engineer" },
  });
  expect(content.status(), await content.text()).toBe(200);
  const team = await api.setOpeningTeam(colleague.token, {
    opening_number: 1,
    version: ((await content.json()) as OrgOpening).version,
    hiring_manager_email: colleague.emailAddress,
    team_member_emails: [],
    internal_notes: "Colleague note",
  });
  expect(team.status(), await team.text()).toBe(200);
  return (await team.json()) as OrgOpening;
}

async function expectLatestLoaded(page: Page) {
  const { title, description, location, manager, recruiter, notes } =
    fields(page);
  await openEditorStep(page, "Basics");
  await expect(title).toHaveValue("Colleague engineer");
  await expect(description).toHaveValue("");
  await openEditorStep(page, "Location");
  await expect(location).toHaveValue("");
  await openEditorStep(page, teamStep);
  await expect(manager).toHaveValue(/^manager@/);
  await expect(recruiter).toHaveValue("");
  await expect(notes).toHaveValue("Colleague note");
}

const failsOnServer = (route: Route) =>
  route.fulfill({
    status: 500,
    contentType: "application/problem+json",
    body: JSON.stringify(InternalServerError),
  });
const losesRequest = (route: Route) => route.abort();
const losesAnswer = async (route: Route) => {
  await route.fetch();
  await route.abort();
};

/** Holds the next `path` request until `release`. */
async function holdNext(page: Page, path: string) {
  let arrive: () => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**/api/orgs/${path}`,
    async (route) => {
      arrive();
      await released;
      await route.continue();
    },
    { times: 1 },
  );
  return { arrived, release };
}

test("a refused team keeps every unsaved edit after its content saved", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async (editing) => {
    const { colleague, created, unknownEmail, ownerEmail, read } = editing;
    const sent = recordWrites(page);
    const { title, manager, members, recruiter, notes, save } = fields(page);
    await title.fill("Edited engineer");
    await openEditorStep(page, "Application questions");
    await page.getByRole("button", { name: "Add question" }).click();
    await fields(page).question.fill("When could you start?");
    await openEditorStep(page, teamStep);
    await manager.fill(colleague.emailAddress);
    await searchAndChooseOption(page, members, colleague.emailAddress);
    await page.keyboard.press("Escape");
    await notes.fill("Edited note");
    await recruiter.fill(unknownEmail);
    await openEditorStep(page, "Basics");
    await save.click();

    const refusal = page.getByText(
      `These addresses are not active members of this organization: ${unknownEmail}.`,
    );
    const expectEditsKept = async () => {
      await expect(refusal).toHaveCount(2);
      await expect(recruiter).toBeFocused();
      await expect(recruiter).toHaveValue(unknownEmail);
      await expect(manager).toHaveValue(colleague.emailAddress);
      await expect(notes).toHaveValue("Edited note");
    };
    await expectEditsKept();
    await refetchOpening(page);
    await expectEditsKept();
    expect((await read()).working_content?.title).toBe("Edited engineer");

    await recruiter.fill(ownerEmail);
    await save.click();
    await expect(page).toHaveURL(/\/openings\/1$/);

    expect(sent.content).toHaveLength(1);
    expect(sent.team).toHaveLength(2);
    expect(sent.team[1]?.key).not.toBe(sent.team[0]?.key);
    expect(sent.team[1]?.body.version).toBe(created.version + 1);
    expect(await read()).toMatchObject({
      version: created.version + 2,
      working_content: {
        title: "Edited engineer",
        questions: [{ text: "When could you start?" }],
      },
      hiring_manager: { email: colleague.emailAddress },
      recruiter: { email: ownerEmail },
      team_members: [{ email: colleague.emailAddress }],
      internal_notes: "Edited note",
    });
  });
});

for (const [failure, handler] of [
  ["a server error", failsOnServer],
  ["a lost request", losesRequest],
  ["a lost answer", losesAnswer],
] as const) {
  for (const corrected of [false, true]) {
    test(`${failure} saving the team keeps the edits, and ${corrected ? "a corrected" : "an unchanged"} retry saves them`, async ({
      page,
      request,
    }) => {
      await withEditor(page, request, async ({ created, read }) => {
        const sent = recordWrites(page);
        const { title, recruiter, notes, save } = fields(page);
        await title.fill("Edited engineer");
        await openEditorStep(page, teamStep);
        await recruiter.fill("");
        await notes.fill("Edited note");
        await page.route("**/api/orgs/set-opening-team", handler, {
          times: 1,
        });
        await save.click();

        await expect(
          page.getByText("The request could not be completed"),
        ).toBeVisible();
        await refetchOpening(page);
        await expect(save).toBeFocused();
        await expect(recruiter).toHaveValue("");
        await expect(notes).toHaveValue("Edited note");
        if (corrected) await notes.fill("Corrected note");
        await save.click();
        await expect(page).toHaveURL(/\/openings\/1$/);

        expect(sent.content).toHaveLength(1);
        expect(sent.team).toHaveLength(corrected ? 3 : 2);
        // The retry repeats the same write under its key; only a different
        // write takes a new one.
        expect(sent.team[1]).toEqual(sent.team[0]);
        if (corrected) expect(sent.team[2]?.key).not.toBe(sent.team[0]?.key);
        const saved = await read();
        expect(saved).toMatchObject({
          version: created.version + (corrected ? 3 : 2),
          working_content: { title: "Edited engineer" },
          internal_notes: corrected ? "Corrected note" : "Edited note",
        });
        expect(saved).not.toHaveProperty("recruiter");
      });
    });
  }
}

test("content whose answer was lost is not saved twice, and new questions keep their ids", async ({
  page,
  request,
}) => {
  await withEditor(
    page,
    request,
    async ({ read, unknownEmail, ownerEmail }) => {
      const sent = recordWrites(page);
      const { title, question, recruiter, save } = fields(page);
      await openEditorStep(page, "Application questions");
      await page.getByRole("button", { name: "Add question" }).click();
      await question.fill("When could you start?");
      await page.route("**/api/orgs/save-opening-working-copy", losesAnswer, {
        times: 1,
      });
      await save.click();
      await expect(
        page.getByText("The request could not be completed"),
      ).toBeVisible();

      await openEditorStep(page, teamStep);
      await recruiter.fill(unknownEmail);
      await save.click();
      await expect(recruiter).toBeFocused();
      expect(sent.content).toHaveLength(2);
      expect(sent.content[1]).toEqual(sent.content[0]);
      const id = (await read()).working_content?.questions?.[0]?.id;
      expect(id).toBeDefined();

      await recruiter.fill(ownerEmail);
      await openEditorStep(page, "Basics");
      await title.fill("Edited engineer");
      await save.click();
      await expect(page).toHaveURL(/\/openings\/1$/);
      expect(sent.content).toHaveLength(3);
      expect(sent.content[2]?.key).not.toBe(sent.content[0]?.key);
      expect(sent.content[2]?.body.content.questions?.[0]?.id).toBe(id);
      expect((await read()).working_content?.questions?.[0]?.id).toBe(id);
    },
  );
});

const colleagueMoments = [
  "before the save",
  "between the content and team saves",
  "after a refused team",
  "before the retry of a failed team",
  "before the retry of a lost answer",
] as const;

for (const moment of colleagueMoments) {
  for (const action of ["save", "publish"] as const) {
    test(`${action} never overwrites a colleague's change made ${moment}`, async ({
      page,
      request,
    }) => {
      await withEditor(page, request, async (editing) => {
        const { created, read, unknownEmail, ownerEmail } = editing;
        const sent = recordWrites(page);
        const controls = fields(page);
        const { title, recruiter, notes } = controls;
        await title.fill("Edited engineer");
        await openEditorStep(page, teamStep);
        await notes.fill("Edited note");
        const submit = controls[action];

        if (moment === "before the save") {
          await colleagueWrites(editing);
          await refetchOpening(page);
          await expect(notes).toHaveValue("Edited note");
          await submit.click();
        } else if (moment === "between the content and team saves") {
          await page.route(
            "**/api/orgs/set-opening-team",
            async (route) => {
              await colleagueWrites(editing);
              await route.continue();
            },
            { times: 1 },
          );
          await submit.click();
        } else {
          if (moment === "after a refused team")
            await recruiter.fill(unknownEmail);
          else
            await page.route(
              "**/api/orgs/set-opening-team",
              moment === "before the retry of a lost answer"
                ? losesAnswer
                : failsOnServer,
              { times: 1 },
            );
          await submit.click();
          await expect(
            page
              .getByText(
                /not active members of this organization|The request could not be completed/,
              )
              .first(),
          ).toBeVisible();
          await colleagueWrites(editing);
          await refetchOpening(page);
          await expect(notes).toHaveValue("Edited note");
          if (moment === "after a refused team")
            await recruiter.fill(ownerEmail);
          else await notes.fill("Corrected note");
          await submit.click();
        }

        await expect(page.getByText(versionConflict)).toBeVisible();
        // Never the colleague's version, whatever was read since the edits.
        const based =
          moment === "before the save" ? created.version : created.version + 1;
        expect(sent.content[0]?.body.version).toBe(created.version);
        for (const { body } of sent.team)
          expect(body.version).toBeLessThanOrEqual(
            moment === "before the retry of a lost answer" ? based + 1 : based,
          );
        expect(sent.publication).toEqual([]);
        const latest = await read();
        expect(latest).toMatchObject({
          state: "draft",
          working_content: { title: "Colleague engineer" },
          hiring_manager: { email: editing.colleague.emailAddress },
          internal_notes: "Colleague note",
        });
        expect(latest).not.toHaveProperty("recruiter");
        expect(latest).not.toHaveProperty("working_content.description");
        await expectLatestLoaded(page);

        await notes.fill("Reviewed note");
        await controls.save.click();
        await expect(page).toHaveURL(/\/openings\/1$/);
        const reviewed = await read();
        expect(reviewed).toMatchObject({
          version: latest.version + 1,
          working_content: { title: "Colleague engineer" },
          internal_notes: "Reviewed note",
        });
        expect(reviewed).not.toHaveProperty("working_content.description");
      });
    });
  }
}

test("a colleague's change after the save stops its publication", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async (editing) => {
    await fields(page).title.fill("Edited engineer");
    await page.route(
      "**/api/orgs/request-opening-change",
      async (route) => {
        await colleagueWrites(editing);
        await route.continue();
      },
      { times: 1 },
    );
    await fields(page).publish.click();

    await expect(page).toHaveURL(/\/openings\/1$/);
    await expect(page.getByText(/^Saved, but not published:/)).toBeVisible();
    expect(await editing.read()).toMatchObject({
      state: "draft",
      working_content: { title: "Colleague engineer" },
    });
  });
});

test("Save and publish publishes every edit once a refused team is corrected", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async (editing) => {
    const { created, read, unknownEmail, ownerEmail } = editing;
    const sent = recordWrites(page);
    const { title, recruiter, notes, publish } = fields(page);
    await title.fill("Published engineer");
    await openEditorStep(page, teamStep);
    await notes.fill("Edited note");
    await recruiter.fill(unknownEmail);
    await publish.click();
    await expect(recruiter).toBeFocused();
    await expect(recruiter).toHaveValue(unknownEmail);
    await expect(notes).toHaveValue("Edited note");
    expect(sent.publication).toEqual([]);

    await recruiter.fill(ownerEmail);
    const held = await holdNext(page, "request-opening-change");
    await publish.click();
    await held.arrived;
    // What is typed now could be neither saved nor published.
    await expect(notes).toBeDisabled();
    held.release();
    await expect(page).toHaveURL(/\/openings\/1$/);

    expect(sent.content).toHaveLength(1);
    expect(sent.publication).toEqual([
      expect.objectContaining({
        body: {
          opening_number: 1,
          version: created.version + 2,
          kind: "publish",
        },
      }),
    ]);
    expect(await read()).toMatchObject({
      state: "published",
      live_content: { title: "Published engineer" },
      internal_notes: "Edited note",
    });
  });
});

test("a refetch, a failed refetch, and a language change keep unsaved input in every section", async ({
  page,
  request,
}) => {
  await page.route("**/api/orgs/get-ai-options", (route) =>
    route.fulfill({
      json: {
        availability: "ready",
        models: [
          {
            model_oid: "ai/qwen3:1.7b",
            display_name: "Qwen",
            vendor: "Test",
            licence: "Test",
            status: "offered",
            input_credits_per_million_tokens: 1,
            output_credits_per_million_tokens: 1,
          },
        ],
        default_model: "ai/qwen3:1.7b",
        balance_available: 100,
      } satisfies AIOptions,
    }),
  );
  await page.route("**/api/orgs/draft-opening-with-ai", (route) =>
    route.fulfill({
      json: {
        content: { description: "Drafted description" },
        dropped_fields: [],
        usage: {
          usage_id: "019f0000-0000-7000-8000-000000000001",
          model_oid: "ai/qwen3:1.7b",
          input_tokens: 1,
          output_tokens: 1,
          credits_charged: 1,
        },
        balance_available: 99,
      } satisfies DraftOpeningResponse,
    }),
  );
  await withEditor(page, request, async (editing) => {
    const { created, colleague, read } = editing;
    const sent = recordWrites(page);
    const { title, description, location, question, members, notes, save } =
      fields(page);
    await page.getByTestId("draft-with-ai").click();
    await page
      .getByRole("textbox", { name: "What should the AI write?" })
      .fill("An engineer");
    await page.getByRole("button", { name: "Generate draft" }).click();
    await expect(description).toHaveValue("Drafted description");
    await title.fill("Edited engineer");
    await openEditorStep(page, "Location");
    await location.fill("Edited office");
    await openEditorStep(page, "Role and requirements");
    await searchAndChooseOption(
      page,
      page.getByRole("combobox", { name: "Tags" }),
      "Python",
    );
    await page.keyboard.press("Escape");
    const years = page.getByRole("spinbutton", { name: "Minimum years" });
    await years.fill("4");
    await openEditorStep(page, "Application questions");
    await page.getByRole("button", { name: "Add question" }).click();
    await question.fill("When could you start?");
    await openEditorStep(page, teamStep);
    await searchAndChooseOption(page, members, colleague.emailAddress);
    await page.keyboard.press("Escape");
    await notes.fill("Edited note");

    const expectEditsKept = async () => {
      await openEditorStep(page, "Basics");
      await expect(title).toHaveValue("Edited engineer");
      await expect(description).toHaveValue("Drafted description");
      await openEditorStep(page, "Location");
      await expect(location).toHaveValue("Edited office");
      await openEditorStep(page, "Role and requirements");
      await expect(years).toHaveValue("4");
      await openEditorStep(page, "Application questions");
      await expect(question).toHaveValue("When could you start?");
      await openEditorStep(page, teamStep);
      await expect(notes).toHaveValue("Edited note");
    };
    await colleagueWrites(editing);
    await refetchOpening(page);
    await expectEditsKept();

    await chooseOption(
      page,
      page.getByRole("combobox", { name: "Select language" }),
      "Deutsch (Deutschland)",
    );
    await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
    await chooseOption(
      page,
      page.getByRole("combobox", { name: "Sprache auswählen" }),
      "English (United States)",
    );
    await expectEditsKept();

    await page.route("**/api/orgs/get-opening", failsOnServer, { times: 2 });
    await refetchOpening(page, 2);
    await expectEditsKept();

    await save.click();
    await expect(page.getByText(versionConflict)).toBeVisible();
    expect(sent.content).toHaveLength(1);
    expect(sent.content[0]?.body).toEqual({
      opening_number: 1,
      version: created.version,
      content: {
        ...storedContent,
        title: "Edited engineer",
        description: "Drafted description",
        location_details: "Edited office",
        experience_years: { min: 4 },
        tags: ["python"],
        questions: [
          {
            text: "When could you start?",
            type: "short_text",
            required: false,
          },
        ],
      },
    });
    expect((await read()).working_content?.title).toBe("Colleague engineer");
    await expectLatestLoaded(page);
  });
});

test("what is typed before a cached Opening's refetch arrives is kept", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async (editing) => {
    const { title, save } = fields(page);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/openings\/1$/);
    await expect(
      page.getByRole("button", { name: "Edit", exact: true }),
    ).toBeVisible();
    await colleagueWrites(editing);
    await page.clock.fastForward(31_000);
    const held = await holdNext(page, "get-opening");
    const answered = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/orgs/get-opening"),
    );
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await held.arrived;
    await title.fill("Edited engineer");
    held.release();
    await (await answered).finished();
    await rendered(page);

    await expect(title).toHaveValue("Edited engineer");
    await save.click();
    await expect(page.getByText(versionConflict)).toBeVisible();
    await expect(title).toHaveValue("Colleague engineer");
  });
});

for (const [path, during] of [
  ["save-opening-working-copy", "content"],
  ["set-opening-team", "team"],
] as const) {
  for (const action of ["save", "publish"] as const) {
    test(`what is typed while ${action} sends the ${during} stays to save again`, async ({
      page,
      request,
    }) => {
      await withEditor(page, request, async ({ created, read }) => {
        const sent = recordWrites(page);
        const controls = fields(page);
        const { title, location, notes } = controls;
        await title.fill("Edited engineer");
        await openEditorStep(page, teamStep);
        await notes.fill("Edited note");
        const held = await holdNext(page, path);
        await controls[action].click();
        await held.arrived;
        await notes.fill("Typed during the save");
        await openEditorStep(page, "Location");
        await location.fill("Typed office");
        held.release();

        await expect(page.getByText(savedButForTyping)).toBeVisible();
        await expect(page).toHaveURL(/\/openings\/1\/edit$/);
        await expect(location).toHaveValue("Typed office");
        await openEditorStep(page, teamStep);
        await expect(notes).toHaveValue("Typed during the save");
        expect(sent.publication).toEqual([]);

        await controls[action].click();
        await expect(page).toHaveURL(/\/openings\/1$/);
        await expect(page.getByText(versionConflict)).toHaveCount(0);
        const saved = await read();
        expect(saved.version).toBeGreaterThanOrEqual(created.version + 4);
        expect(saved).toMatchObject({
          state: action === "publish" ? "published" : "draft",
          internal_notes: "Typed during the save",
          [action === "publish" ? "live_content" : "working_content"]: {
            title: "Edited engineer",
            location_details: "Typed office",
          },
        });
      });
    });
  }
}

test("a clean form shows fresh data, cleared fields included, and saves on it", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async (editing) => {
    const latest = await colleagueWrites(editing);
    await refetchOpening(page);
    await expectLatestLoaded(page);

    const sent = recordWrites(page);
    await fields(page).notes.fill("Reviewed note");
    await fields(page).save.click();
    await expect(page).toHaveURL(/\/openings\/1$/);
    expect(sent.content).toEqual([]);
    expect(sent.team[0]?.body.version).toBe(latest.version);
    const saved = await editing.read();
    expect(saved).not.toHaveProperty("working_content.description");
    expect(saved.internal_notes).toBe("Reviewed note");
  });
});

test("a clean form follows a freeze of its content and still saves the team", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async ({ api, colleague, created, read }) => {
    const requested = await api.requestOpeningChange(colleague.token, {
      opening_number: 1,
      version: created.version,
      kind: "publish",
    });
    expect(requested.status(), await requested.text()).toBe(200);
    await refetchOpening(page);
    const { title, notes, save } = fields(page);
    await expect(page.getByText(/^Content is frozen/)).toBeVisible();
    await expect(title).toBeDisabled();

    await openEditorStep(page, teamStep);
    await notes.fill("Edited note");
    await save.click();
    await expect(page).toHaveURL(/\/openings\/1$/);
    expect((await read()).internal_notes).toBe("Edited note");
  });
});

test("content frozen under unsaved edits is refused, never dropped silently", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async ({ api, colleague, created }) => {
    const { title, save } = fields(page);
    await title.fill("Edited engineer");
    const requested = await api.requestOpeningChange(colleague.token, {
      opening_number: 1,
      version: created.version,
      kind: "publish",
    });
    expect(requested.status(), await requested.text()).toBe(200);
    await refetchOpening(page);
    await expect(title).toHaveValue("Edited engineer");

    await save.click();
    await expect(page.getByText(versionConflict)).toBeVisible();
    await expect(title).toHaveValue("Stored engineer");
    await expect(title).toBeDisabled();
  });
});

test("an Opening discarded under unsaved edits keeps them until the save is refused", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async ({ api, colleague, created }) => {
    const { title, save } = fields(page);
    await title.fill("Edited engineer");
    const discarded = await api.discardOpening(colleague.token, {
      opening_number: 1,
      version: created.version,
    });
    expect(discarded.status(), await discarded.text()).toBe(200);
    await refetchOpening(page);
    await expect(title).toHaveValue("Edited engineer");

    await save.click();
    await expect(
      page.getByText("This Opening cannot be edited in its current state."),
    ).toBeVisible();
  });
});

test("a clean form follows its Opening's discard", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async ({ api, colleague, created }) => {
    const discarded = await api.discardOpening(colleague.token, {
      opening_number: 1,
      version: created.version,
    });
    expect(discarded.status(), await discarded.text()).toBe(200);
    await refetchOpening(page);
    await expect(
      page.getByText("This Opening cannot be edited in its current state."),
    ).toBeVisible();
  });
});

test("a version conflict says the latest was loaded only once it was", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async (editing) => {
    const { title, save } = fields(page);
    await title.fill("Edited engineer");
    await colleagueWrites(editing);
    await page.route("**/api/orgs/get-opening", failsOnServer, { times: 2 });
    await save.click();
    await expect(
      page.getByText("The request could not be completed"),
    ).toBeVisible();
    await expect(page.getByText(versionConflict)).toHaveCount(0);
    await expect(title).toHaveValue("Edited engineer");

    await save.click();
    await expect(page.getByText(versionConflict)).toBeVisible();
    await expectLatestLoaded(page);
  });
});

test("another Opening never receives this one's values or unfinished save", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async ({ api, owner, created, read }) => {
    const second = await api.createOpening(owner, {
      content: { title: "Second engineer" },
      team_member_emails: [],
    });
    expect(second.status(), await second.text()).toBe(201);
    // With the language and country the server gives a new Opening.
    const secondContent = ((await second.json()) as OrgOpening).working_content;
    const { title, description, recruiter, notes, save } = fields(page);
    const visit = (path: string) =>
      page.evaluate((to) => {
        history.pushState({}, "", to);
        dispatchEvent(new PopStateEvent("popstate"));
      }, path);
    await visit("/openings/2/edit");
    await expect(title).toHaveValue("Second engineer");
    await visit("/openings/1/edit");
    await expect(title).toHaveValue("Stored engineer");
    await openEditorStep(page, teamStep);
    await notes.fill("Only for the first");
    await page.route("**/api/orgs/set-opening-team", losesRequest, {
      times: 1,
    });
    await save.click();
    await expect(
      page.getByText("The request could not be completed"),
    ).toBeVisible();

    // Cached, so there is no loading state between the two editors.
    await visit("/openings/2/edit");
    await expect(title).toHaveValue("Second engineer");
    await expect(description).toHaveValue("");
    await openEditorStep(page, teamStep);
    await expect(recruiter).toHaveValue("");
    await expect(notes).toHaveValue("");
    await notes.fill("Only for the second");
    await save.click();
    await expect(page).toHaveURL(/\/openings\/2$/);
    expect(await read(1)).toEqual(created);
    const saved = await read(2);
    expect(saved.internal_notes).toBe("Only for the second");
    expect(saved.working_content).toEqual(secondContent);
  });
});

function leavePrompt(page: Page) {
  const prompt = page.getByRole("dialog", { name: "Leave without saving?" });
  return {
    prompt,
    stay: prompt.getByRole("button", { name: "Stay", exact: true }),
    leave: prompt.getByRole("button", { name: "Leave", exact: true }),
  };
}

test("Cancel, the sidebar, and Back ask before discarding an Opening's edits", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async ({ created, read }) => {
    const { title } = fields(page);
    const cancel = page
      .getByRole("main")
      .getByRole("button", { name: "Cancel", exact: true });
    const edit = page.getByRole("button", { name: "Edit", exact: true });
    const { prompt, stay, leave } = leavePrompt(page);

    // Nothing to lose, so nothing asks; this also gives Back an entry.
    await cancel.click();
    await expect(page).toHaveURL(/\/openings\/1$/);
    await edit.click();
    await title.fill("Edited engineer");

    for (const [go, left] of [
      [() => cancel.click(), /\/openings\/1$/],
      [() => sidebarPage(page, "Openings").click(), /\/openings$/],
      [() => page.evaluate(() => history.back()), /\/openings\/1$/],
    ] as const) {
      await go();
      await expect(prompt).toBeVisible();
      await stay.click();
      await expect(prompt).toHaveCount(0);
      await expect(page).toHaveURL(/\/openings\/1\/edit$/);
      await expect(title).toHaveValue("Edited engineer");

      await go();
      await leave.click();
      await expect(page).toHaveURL(left);
      await expect(prompt).toHaveCount(0);
      expect(await read()).toEqual(created);

      if (!page.url().endsWith("/openings/1"))
        await page.evaluate(() => history.back());
      if (page.url().endsWith("/openings/1")) await edit.click();
      await expect(title).toHaveValue("Stored engineer");
      await title.fill("Edited engineer");
    }
  });
});

test("edits outside the content ask too, and undoing them stops asking", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async () => {
    const { notes } = fields(page);
    const cancel = page
      .getByRole("main")
      .getByRole("button", { name: "Cancel", exact: true });
    const { prompt, stay } = leavePrompt(page);
    await openEditorStep(page, teamStep);
    await notes.fill("Edited note");
    await cancel.click();
    await stay.click();
    await expect(prompt).toHaveCount(0);
    await notes.fill("Stored note");
    await cancel.click();
    await expect(page).toHaveURL(/\/openings\/1$/);
    await expect(prompt).toHaveCount(0);
  });
});

test("closing the tab asks only while the Opening has unsaved edits", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async () => {
    const { title } = fields(page);
    await title.fill("Edited engineer");
    const asked = page.waitForEvent("dialog");
    await page.close({ runBeforeUnload: true });
    const dialog = await asked;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    await expect(title).toHaveValue("Edited engineer");

    await title.fill("Stored engineer");
    const closed = page.waitForEvent("close");
    await page.close({ runBeforeUnload: true });
    await closed;
  });
});

test("a save that ends while the prompt is open leaves without it", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async ({ read }) => {
    const { title, save } = fields(page);
    await title.fill("Edited engineer");
    const held = await holdNext(page, "save-opening-working-copy");
    await save.click();
    await held.arrived;
    await sidebarPage(page, "Openings").click();
    const { prompt } = leavePrompt(page);
    await expect(prompt).toBeVisible();
    held.release();
    await expect(page).toHaveURL(/\/openings\/1$/);
    await expect(prompt).toHaveCount(0);
    expect((await read()).working_content?.title).toBe("Edited engineer");
  });
});

test("an Opening that cannot be edited leaves without asking", async ({
  page,
  request,
}) => {
  await withEditor(page, request, async ({ api, owner, created }) => {
    const discarded = await api.discardOpening(owner, {
      opening_number: 1,
      version: created.version,
    });
    expect(discarded.status(), await discarded.text()).toBe(200);
    await page.reload();
    await expect(
      page.getByText("This Opening cannot be edited in its current state."),
    ).toBeVisible();
    await sidebarPage(page, "Openings").click();
    await expect(page).toHaveURL(/\/openings$/);
    await expect(leavePrompt(page).prompt).toHaveCount(0);
  });
});

test("a new Opening asks once edited, and its creation leaves without asking", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org) => {
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/new`);
    const cancel = page
      .getByRole("main")
      .getByRole("button", { name: "Cancel", exact: true });
    const { title, notes } = fields(page);
    const { prompt, stay } = leavePrompt(page);

    // The Org's country and language are filled in, which is no edit.
    await openEditorStep(page, "Location");
    await expect(page.getByTitle("Singapore", { exact: true })).toBeVisible();
    await cancel.click();
    await expect(page).toHaveURL(/\/openings$/);
    await expect(prompt).toHaveCount(0);

    await page.goto(`${ORGS_PORTAL}/openings/new`);
    await title.fill("New engineer");
    await cancel.click();
    await stay.click();
    await expect(prompt).toHaveCount(0);

    // Creation closes the editor, so it takes no input while it runs.
    await page.route("**/api/orgs/create-opening", failsOnServer, {
      times: 1,
    });
    const create = page.getByRole("button", { name: "Create draft" });
    await create.click();
    await expect(
      page.getByText("The request could not be completed"),
    ).toBeVisible();
    await expect(title).toBeEnabled();
    await cancel.click();
    await stay.click();
    await expect(prompt).toHaveCount(0);

    const held = await holdNext(page, "create-opening");
    await create.click();
    await held.arrived;
    await expect(title).toBeDisabled();
    await openEditorStep(page, teamStep);
    await expect(notes).toBeDisabled();
    held.release();
    await expect(page).toHaveURL(/\/openings\/1$/);
    await expect(prompt).toHaveCount(0);
  });
});
