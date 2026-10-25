import type { Page } from "@playwright/test";
import type { ApplicationDetail } from "typespec/orgs/applications/applications";
import type { PipelineStage } from "typespec/orgs/hiring/pipelines";
import { expect, test } from "../lib/admin-fixtures.ts";
import {
  ageTerminalApplication,
  seedApplicationNumber,
  seedSubmitted,
} from "../lib/hiring-seed.ts";
import { addOrgMember } from "../lib/orgs-api.ts";
import {
  detailOf,
  publishedOpening,
  shortlist,
  stageOf,
  utcDate,
} from "../lib/orgs-applications.ts";
import { signIn, withOrg } from "../lib/orgs-ui.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";

test.describe.configure({ timeout: 120_000 });

const fourStages = [
  { name: "Screen", kind: "review" },
  { name: "Exercise", kind: "assessment" },
  { name: "Panel", kind: "interview" },
  { name: "Checks", kind: "background_check" },
] as const;

async function openingTab(
  page: Page,
  opening: number,
  tab: "applicants" | "candidates",
  query = "",
) {
  await page.goto(`${ORGS_PORTAL}/openings/${opening}?tab=${tab}${query}`);
}

async function chooseOption(page: Page, combobox: string, option: string) {
  await page.getByRole("combobox", { name: combobox }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByTitle(option, { exact: true })
    .click();
}

test("Applicants tab searches by name, keeps the filter in the URL, and pages", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    await seedApplicationNumber(world, n, { name: "Grace Hopper" });
    await seedApplicationNumber(world, n, { name: "Alan Turing" });
    await seedSubmitted(world, n, 24, "Batch");
    await signIn(page, org);
    await openingTab(page, n, "applicants");

    await expect(page.getByRole("tab", { name: /^Applicants/ })).toContainText(
      "26",
    );
    await expect(page.getByRole("row")).toHaveCount(26);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("row")).toHaveCount(2);
    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByRole("row")).toHaveCount(26);

    const search = page.getByRole("searchbox", { name: "Search by name" });
    await search.fill("grace");
    await search.press("Enter");
    await expect(page).toHaveURL(/q=grace/);
    await expect(
      page.getByRole("link", { name: "Grace Hopper" }),
    ).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(2);

    // The filter survives a reload.
    await page.reload();
    await expect(
      page.getByRole("searchbox", { name: "Search by name" }),
    ).toHaveValue("grace");
    await expect(page.getByRole("row")).toHaveCount(2);

    // One character is refused beside the field and changes nothing.
    await search.fill("g");
    await search.press("Enter");
    await expect(page.getByText("Type at least 2 characters.")).toBeVisible();
    await expect(page).toHaveURL(/q=grace/);

    await search.fill("zzz");
    await search.press("Enter");
    await expect(
      page.getByText("No applications match these filters."),
    ).toBeVisible();

    await search.fill("");
    await expect(page).not.toHaveURL(/q=/);
    await expect(page.getByRole("row")).toHaveCount(26);
  });
});

test("an applicant is shortlisted at a chosen stage and becomes a candidate", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening, stages } = await publishedOpening(api, owner, org, {
      stages: [...fourStages],
    });
    const n = opening.opening_number;
    const application = await seedApplicationNumber(world, n, {
      name: "Grace Hopper",
    });
    await signIn(page, org);
    await openingTab(page, n, "applicants");

    await page.getByRole("button", { name: "Shortlist Grace Hopper" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Shortlist Grace Hopper",
    });
    await expect(dialog.getByRole("radio", { name: /^Screen/ })).toBeChecked();
    await expect(dialog.getByText(/sees “In review”/)).toBeVisible();
    await dialog.getByRole("radio", { name: /^Panel/ }).check();
    await expect(dialog.getByText(/sees “Interviewing”/)).toBeVisible();
    await dialog
      .getByRole("button", { name: "Shortlist", exact: true })
      .click();

    await expect(
      page.getByText("Grace Hopper is now a candidate."),
    ).toBeVisible();
    await expect(
      page.getByText("No one is waiting for a decision."),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: /^Candidates/ })).toContainText(
      "1",
    );

    const detail = await detailOf(api, owner, n, application);
    expect(detail.state).toBe("in_pipeline");
    expect(detail.current_stage?.id).toBe(stageOf(stages, 2).id);

    await page.getByRole("tab", { name: /^Candidates/ }).click();
    await expect(
      page.getByRole("link", { name: "Grace Hopper" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /3\. Panel/ })).toContainText(
      "1",
    );
  });
});

test("cancelling the shortlist dialog changes nothing", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const application = await seedApplicationNumber(world, n, {
      name: "Grace Hopper",
    });
    await signIn(page, org);
    await openingTab(page, n, "applicants");
    await page.getByRole("button", { name: "Shortlist Grace Hopper" }).click();
    await page
      .getByRole("dialog", { name: "Shortlist Grace Hopper" })
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await detailOf(api, owner, n, application)).state).toBe(
      "submitted",
    );
  });
});

test("an applicant is marked not progressing after a confirmation", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const application = await seedApplicationNumber(world, n, {
      name: "Ada Byron",
    });
    await signIn(page, org);
    await openingTab(page, n, "applicants");
    await page
      .getByRole("button", { name: "Mark Ada Byron as not progressing" })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Mark Ada Byron as not progressing?",
    });
    await expect(dialog.getByText("This cannot be undone.")).toBeVisible();
    await dialog.getByRole("button", { name: "Not progressing" }).click();
    await expect(
      page.getByText("Ada Byron is marked as not progressing."),
    ).toBeVisible();
    expect((await detailOf(api, owner, n, application)).state).toBe(
      "not_progressing",
    );
    await page.getByRole("tab", { name: /^Candidates/ }).click();
    await page.getByRole("tab", { name: /^Not progressing/ }).click();
    await expect(page).toHaveURL(/view=not_progressing/);
    await expect(page.getByRole("link", { name: "Ada Byron" })).toBeVisible();
  });
});

test("application detail completes a review, moves past stages, and ends the application", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening, stages } = await publishedOpening(api, owner, org, {
      stages: [...fourStages],
    });
    const n = opening.opening_number;
    const application = await seedApplicationNumber(world, n, {
      name: "Grace Hopper",
      coverNote: "Wrote the first program",
    });
    await shortlist(api, owner, n, application, stageOf(stages, 0));
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/${n}/applications/${application}`);

    await expect(
      page.getByRole("heading", { name: /Grace Hopper/, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("In pipeline", { exact: true })).toBeVisible();
    await expect(page.getByText("Wrote the first program")).toBeVisible();

    await page.getByRole("button", { name: "Mark review completed" }).click();
    await page
      .getByRole("dialog", { name: "Mark review completed?" })
      .getByRole("button", { name: "Mark completed" })
      .click();
    await expect(page.getByText("Review marked as completed.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Mark review completed" }),
    ).toHaveCount(0);

    // Moving to the last stage names the stages it skips.
    await chooseOption(
      page,
      "Move to a later stage",
      "Checks · Background check",
    );
    await expect(page.getByText("Skips: Exercise, Panel.")).toBeVisible();
    await page.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByText("Moved to the new stage.")).toBeVisible();
    const moved = await detailOf(api, owner, n, application);
    expect(moved.current_stage?.id).toBe(stageOf(stages, 3).id);
    expect(
      moved.stage_records.map((record) => [record.stage.name, record.status]),
    ).toEqual([
      ["Screen", "completed"],
      ["Exercise", "skipped"],
      ["Panel", "skipped"],
      ["Checks", "pending"],
    ]);
    await expect(
      page.getByRole("combobox", { name: "Move to a later stage" }),
    ).toHaveCount(0);
    await expect(page.getByText(/Moved to a stage · Checks/)).toBeVisible();

    await page.getByRole("button", { name: "Not progressing" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Mark Grace Hopper as not progressing?",
    });
    await expect(
      dialog.getByText(/Upcoming interviews are cancelled/),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Not progressing" }).click();
    await expect(
      page.getByText(
        "This application has ended, so there is nothing left to do.",
      ),
    ).toBeVisible();
    expect((await detailOf(api, owner, n, application)).state).toBe(
      "not_progressing",
    );
    await expect(page.getByText(/Marked not progressing · /)).toBeVisible();
  });
});

test("an action on a stale application is refused with the reason", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening, stages } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const application = await seedApplicationNumber(world, n, {
      name: "Ada Byron",
    });
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/${n}/applications/${application}`);
    await expect(
      page.getByRole("heading", { name: /Ada Byron/, level: 1 }),
    ).toBeVisible();
    await shortlist(api, owner, n, application, stageOf(stages, 0));

    await page.getByRole("button", { name: "Shortlist", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Shortlist Ada Byron" });
    await dialog
      .getByRole("button", { name: "Shortlist", exact: true })
      .click();
    await expect(dialog.getByText(/changed since you opened it/)).toBeVisible();
  });
});

test("Candidates tab filters by stage, finished state, and waiting action, all in the URL", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening, stages } = await publishedOpening(api, owner, org, {
      stages: [...fourStages],
    });
    const n = opening.opening_number;
    const screening = await seedApplicationNumber(world, n, {
      name: "Screening Sam",
    });
    const paneled = await seedApplicationNumber(world, n, {
      name: "Panel Pat",
    });
    await shortlist(api, owner, n, screening, stageOf(stages, 0));
    await shortlist(api, owner, n, paneled, stageOf(stages, 2));
    await seedApplicationNumber(world, n, {
      name: "Joined Jo",
      state: "joined",
      joinedOn: utcDate(-3),
      stageId: stageOf(stages, 3).id,
    });
    await seedApplicationNumber(world, n, {
      name: "Stopped Stu",
      state: "not_progressing",
      stageId: stageOf(stages, 1).id,
    });
    await signIn(page, org);
    await openingTab(page, n, "candidates");

    await expect(page.getByRole("tab", { name: /^Active/ })).toContainText("2");
    await expect(page.getByRole("tab", { name: /^Joined/ })).toContainText("1");
    await expect(
      page.getByRole("link", { name: "Screening Sam" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Panel Pat" })).toBeVisible();

    await page.getByRole("button", { name: /1\. Screen/ }).click();
    await expect(page).toHaveURL(/stage=/);
    await expect(page.getByRole("link", { name: "Panel Pat" })).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: /1\. Screen/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("link", { name: "Screening Sam" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "All active" }).click();
    await expect(page).not.toHaveURL(/stage=/);
    await expect(page.getByRole("link", { name: "Panel Pat" })).toBeVisible();

    await page.getByRole("tab", { name: /^Joined/ }).click();
    await expect(page).toHaveURL(/view=joined/);
    await expect(page.getByRole("link", { name: "Joined Jo" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Screening Sam" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: /1\. Screen/ })).toHaveCount(
      0,
    );

    await page.getByRole("tab", { name: /^Active/ }).click();
    await chooseOption(page, "Waiting on candidate", "Offer response");
    await expect(page).toHaveURL(/pending=offer_response/);
    await expect(
      page.getByText("No applications match these filters."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/pending=/);
    await expect(page.getByRole("link", { name: "Panel Pat" })).toBeVisible();
  });
});

test("joining is recorded with an over-hiring warning, then separated and corrected", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening, stages } = await publishedOpening(api, owner, org, {
      positions: 1,
    });
    const n = opening.opening_number;
    await seedApplicationNumber(world, n, {
      name: "Already Joined",
      state: "joined",
      joinedOn: utcDate(-30),
      stageId: stageOf(stages, 1).id,
    });
    const accepted = await seedApplicationNumber(world, n, {
      name: "Grace Hopper",
      state: "offer_accepted",
      stageId: stageOf(stages, 1).id,
      offerExtendedDaysAgo: 30,
    });
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/${n}/applications/${accepted}`);

    await page.getByRole("button", { name: "Record joined" }).click();
    const dialog = page.getByRole("dialog", { name: "Record joining date" });
    await expect(
      dialog.getByText(/1 of 1 planned positions are already filled/),
    ).toBeVisible();

    // A date before the offer was extended is refused by the API.
    await dialog.getByLabel("Joined on").fill(utcDate(-40));
    await dialog.getByRole("button", { name: "Record joined" }).click();
    await expect(dialog.getByText(/That date is not allowed/)).toBeVisible();

    await dialog.getByLabel("Joined on").fill(utcDate(-20));
    await dialog.getByRole("button", { name: "Record joined" }).click();
    await expect(page.getByText("Date saved.").first()).toBeVisible();
    await expect(
      page.getByText("Joined", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(/2 people have joined against 1 planned positions/),
    ).toBeVisible();
    expect((await detailOf(api, owner, n, accepted)).joined_on).toBe(
      utcDate(-20),
    );

    await page.getByRole("button", { name: "Record separation" }).click();
    await page
      .getByRole("dialog", { name: "Record separation date" })
      .getByLabel("Separated on")
      .fill(utcDate(-5));
    await page
      .getByRole("dialog", { name: "Record separation date" })
      .getByRole("button", { name: "Record separation" })
      .click();
    await expect(
      page.getByRole("button", { name: "Correct separation date" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Correct joining date" }).click();
    const correct = page.getByRole("dialog", { name: "Correct joining date" });
    await expect(correct.getByLabel("Joined on")).toHaveValue(utcDate(-20));
    await correct.getByLabel("Joined on").fill(utcDate(-19));
    await correct.getByRole("button", { name: "Save date" }).click();
    await expect(correct).toBeHidden();
    const final = await detailOf(api, owner, n, accepted);
    expect(final.joined_on).toBe(utcDate(-19));
    expect(final.separated_on).toBe(utcDate(-5));
    await expect(page.getByText(/Joining date corrected/)).toBeVisible();
    await expect(page.getByText(/Separation recorded/)).toBeVisible();

    // The Opening shows the same warning beside its hired count.
    await page.goto(`${ORGS_PORTAL}/openings/${n}`);
    await expect(
      page.getByText("More people joined than planned."),
    ).toBeVisible();
  });
});

test("a candidate who accepted but did not join is recorded as such", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening, stages } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const accepted = await seedApplicationNumber(world, n, {
      name: "Grace Hopper",
      state: "offer_accepted",
      stageId: stageOf(stages, 1).id,
      offerExtendedDaysAgo: 3,
    });
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/${n}/applications/${accepted}`);
    await page.getByRole("button", { name: "Did not join" }).click();
    await page
      .getByRole("dialog", { name: "Record that they did not join?" })
      .getByRole("button", { name: "Did not join" })
      .click();
    await expect(page.getByText("Recorded as did not join.")).toBeVisible();
    expect((await detailOf(api, owner, n, accepted)).state).toBe(
      "did_not_join",
    );
  });
});

test("closing an Opening offers to mark open applications not progressing", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const marked = await publishedOpening(api, owner, org, { title: "Marked" });
    const kept = await publishedOpening(api, owner, org, { title: "Kept" });
    const prepare = async (opening: number, stage: PipelineStage) => {
      const applicant = await seedApplicationNumber(world, opening, {
        name: "New One",
      });
      const candidate = await seedApplicationNumber(world, opening, {
        name: "Cand One",
      });
      await shortlist(api, owner, opening, candidate, stage);
      return { applicant, candidate };
    };
    const first = await prepare(
      marked.opening.opening_number,
      stageOf(marked.stages, 0),
    );
    const second = await prepare(
      kept.opening.opening_number,
      stageOf(kept.stages, 0),
    );
    await signIn(page, org);

    await page.goto(`${ORGS_PORTAL}/openings/${marked.opening.opening_number}`);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("checkbox", {
        name: /Also mark the 2 open applications as not progressing \(1 applicants, 1 candidates\)/,
      }),
    ).toBeChecked();
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Opening updated.")).toBeVisible();
    for (const number of [first.applicant, first.candidate]) {
      expect(
        (await detailOf(api, owner, marked.opening.opening_number, number))
          .state,
      ).toBe("not_progressing");
    }

    await page.goto(`${ORGS_PORTAL}/openings/${kept.opening.opening_number}`);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const keepDialog = page.getByRole("dialog");
    await keepDialog.getByRole("checkbox").uncheck();
    await keepDialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Opening updated.")).toBeVisible();
    expect(
      (
        await detailOf(
          api,
          owner,
          kept.opening.opening_number,
          second.applicant,
        )
      ).state,
    ).toBe("submitted");
    expect(
      (
        await detailOf(
          api,
          owner,
          kept.opening.opening_number,
          second.candidate,
        )
      ).state,
    ).toBe("in_pipeline");
  });
});

test("a pending close request shows whether open applications will be marked", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const { opening } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    await seedApplicationNumber(world, n, { name: "New One" });
    const fresh = await api.getOpening(owner, { opening_number: n });
    const version = ((await fresh.json()) as { version: number }).version;
    const requested = await api.requestOpeningChange(manager.token, {
      opening_number: n,
      version,
      kind: "close",
      mark_applications_not_progressing: true,
    });
    expect(requested.status(), await requested.text()).toBe(200);

    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/${n}`);
    await expect(page.getByText("Marked not progressing")).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByText(/also marks every open application as not progressing/),
    ).toBeVisible();
  });
});

test("people who may only read an Opening's applications see no actions", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const reader = await addOrgMember(
      api,
      owner,
      org.domain,
      `reader@${org.domain}`,
      [],
    );
    const { opening } = await publishedOpening(api, owner, org, {
      team: [reader.emailAddress],
    });
    const n = opening.opening_number;
    const application = await seedApplicationNumber(world, n, {
      name: "Grace Hopper",
    });
    await signIn(page, reader);
    await openingTab(page, n, "applicants");
    await expect(
      page.getByRole("link", { name: "Grace Hopper" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Shortlist/ })).toHaveCount(
      0,
    );
    await expect(page.getByText(/Only the hiring manager/)).toBeVisible();

    await page.getByRole("link", { name: "Grace Hopper" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/openings/${n}/applications/${application}$`),
    );
    await expect(
      page.getByText(/You can read this application but not act on it/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Not progressing" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Shortlist", exact: true }),
    ).toHaveCount(0);
  });
});

test("a holder of candidacy access acts without being on the Opening's team", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const recruiter = await addOrgMember(
      api,
      owner,
      org.domain,
      `recruiter@${org.domain}`,
      ["org:manage_candidacies", "org:view_openings"],
    );
    const { opening } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    await seedApplicationNumber(world, n, { name: "Grace Hopper" });
    await signIn(page, recruiter);
    await openingTab(page, n, "applicants");
    await expect(
      page.getByRole("button", { name: "Shortlist Grace Hopper" }),
    ).toBeVisible();
  });
});

test("an Opening's applications are hidden from members who cannot read them", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const outsider = await addOrgMember(
      api,
      owner,
      org.domain,
      `outsider@${org.domain}`,
      [],
    );
    const { opening } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const application = await seedApplicationNumber(world, n, {
      name: "Grace Hopper",
    });
    await signIn(page, outsider);
    await page.goto(`${ORGS_PORTAL}/openings/${n}`);
    await expect(page.getByRole("tab", { name: /^Applicants/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /^Candidates/ })).toHaveCount(0);
    await page.goto(`${ORGS_PORTAL}/openings/${n}/applications/${application}`);
    await expect(
      page.getByText("This application was not found, or you cannot read it."),
    ).toBeVisible();
  });
});

test("a removed applicant reads as Removed applicant", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    // A withdrawn application a year old is removed by the retention job.
    const application = await seedApplicationNumber(world, n, {
      name: "Grace Hopper",
      state: "withdrawn",
    });
    ageTerminalApplication(world, n, application, 366);
    await expect
      .poll(async () => (await detailOf(api, owner, n, application)).removed, {
        timeout: 30_000,
      })
      .toBe(true);
    await signIn(page, org);
    await openingTab(page, n, "candidates", "&view=withdrawn");
    await expect(
      page.getByRole("link", { name: "Removed applicant" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Removed applicant" }).click();
    await expect(
      page.getByRole("heading", { name: /Removed applicant/, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /The retention period ended, so this applicant's data was deleted/,
      ),
    ).toBeVisible();
    // Nothing else of the profile is shown.
    await expect(page.getByText("Grace Hopper")).toHaveCount(0);
  });
});

test("application detail shows assessment results and a pending background-check consent", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening, stages } = await publishedOpening(api, owner, org, {
      stages: [...fourStages],
    });
    const n = opening.opening_number;
    const application = await seedApplicationNumber(world, n, {
      name: "Grace Hopper",
    });
    const shortlisted = await shortlist(
      api,
      owner,
      n,
      application,
      stageOf(stages, 1),
    );
    const assessed = await api.recordAssessmentResult(owner, {
      opening_number: n,
      application_number: application,
      version: shortlisted.version,
      outcome: "pass",
      score: 82,
      notes: "Strong portfolio",
    });
    expect(assessed.status(), await assessed.text()).toBe(200);
    const afterAssessment = (await assessed.json()) as ApplicationDetail;
    const moved = await api.moveApplicationStage(owner, {
      opening_number: n,
      application_number: application,
      version: afterAssessment.version,
      stage_id: stageOf(stages, 3).id,
    });
    expect(moved.status(), await moved.text()).toBe(200);
    const atChecks = (await moved.json()) as ApplicationDetail;
    const consent = await api.requestBackgroundCheckConsent(owner, {
      opening_number: n,
      application_number: application,
      version: atChecks.version,
      check_types: ["identity", "employment"],
    });
    expect(consent.status(), await consent.text()).toBe(200);

    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/${n}/applications/${application}`);
    const assessments = page.getByText("Assessments", { exact: true });
    await expect(assessments).toBeVisible();
    await expect(page.getByText("Score 82")).toBeVisible();
    await expect(page.getByText("Strong portfolio")).toBeVisible();
    await expect(
      page.getByText("Consent requested", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Employment", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Consent for the background check at “Checks”"),
    ).toBeVisible();
    await expect(page.getByText("Assessment result recorded")).toBeVisible();
    await expect(
      page.getByText(/Background check consent requested/),
    ).toBeVisible();

    // The list can find candidates the applicant still has to answer.
    await openingTab(
      page,
      n,
      "candidates",
      "&pending=background_check_consent",
    );
    await expect(
      page.getByRole("link", { name: "Grace Hopper" }),
    ).toBeVisible();
    await openingTab(page, n, "candidates", "&pending=offer_response");
    await expect(
      page.getByText("No applications match these filters."),
    ).toBeVisible();
  });
});

test("an unknown application says so and offers a way back", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, _world) => {
    const { opening } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/${n}/applications/999`);
    await expect(
      page.getByText("This application was not found, or you cannot read it."),
    ).toBeVisible();
    await page.getByRole("link", { name: "Back to the Opening" }).click();
    await expect(page).toHaveURL(new RegExp(`/openings/${n}$`));
  });
});
