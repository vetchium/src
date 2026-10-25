import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { PipelineStage } from "typespec/orgs/hiring/pipelines";
import { expect, test } from "../lib/admin-fixtures.ts";
import {
  type HiringOrg,
  type SeededApplication,
  seedApplication,
} from "../lib/hiring-seed.ts";
import { hubIdempotencyKey } from "../lib/hub-api.ts";
import { addOrgMember, orgSQL } from "../lib/orgs-api.ts";
import {
  detailOf,
  orgDIDSQL,
  publishedOpening,
  stageOf,
  utcDate,
} from "../lib/orgs-applications.ts";
import { signIn, signOut, withOrg } from "../lib/orgs-ui.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";

test.describe.configure({ timeout: 180_000 });

const pipeline = [
  { name: "Screen", kind: "review" },
  { name: "Exercise", kind: "assessment" },
  { name: "Panel", kind: "interview" },
  { name: "Checks", kind: "background_check" },
] as const;

/** `datetime-local` text for tomorrow at 10:00 in the browser's zone. */
function tomorrowAt10(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T10:00`;
}

function applicationURL(opening: number, application: number): string {
  return `${ORGS_PORTAL}/openings/${opening}/applications/${application}`;
}

/** Runs `set` against one application's rows of `table`, as the table owner. */
function applicationRowsSQL(
  domain: string,
  opening: number,
  application: number,
  table: "org_interviews" | "org_background_checks",
  set: string,
  extra = "",
) {
  orgSQL(
    `UPDATE vetchium.${table} AS t SET ${set}
     FROM vetchium.org_applications AS a
     JOIN vetchium.org_openings AS o USING (org_opening_id)
     WHERE a.org_application_id = t.org_application_id
       AND o.org_did = ${orgDIDSQL(domain)}
       AND o.opening_number = ${opening}
       AND a.application_number = ${application}
       ${extra}`,
  );
}

/** A candidate shortlisted to stage, with the applicant who applied. */
async function candidateFor(
  world: HiringOrg,
  opening: number,
  stage: PipelineStage,
  name = "Ada Lovelace",
): Promise<SeededApplication> {
  return seedApplication(world, opening, {
    name,
    state: "in_pipeline",
    stageId: stage.id,
  });
}

async function candidateAt(
  world: HiringOrg,
  opening: number,
  stage: PipelineStage,
  name?: string,
): Promise<number> {
  return (await candidateFor(world, opening, stage, name)).number;
}

test("an interview is scheduled, changed, run, and given feedback by its interviewers", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const panelist = await addOrgMember(
      api,
      owner,
      org.domain,
      `panel-${randomUUID()}@${org.domain}`,
    );
    const { opening, stages } = await publishedOpening(api, owner, org, {
      stages: [...pipeline],
    });
    const n = opening.opening_number;
    const application = await candidateAt(world, n, stageOf(stages, 2));
    await signIn(page, org);

    // Nobody has an interview yet.
    await page.goto(`${ORGS_PORTAL}/my-interviews`);
    await expect(
      page.getByText("You are not an interviewer on any interview yet."),
    ).toBeVisible();

    await page.goto(applicationURL(n, application));
    await page.getByRole("button", { name: "Schedule interview" }).click();
    const dialog = page.getByRole("dialog", { name: "Schedule an interview" });
    await expect(
      dialog.getByRole("button", { name: "Schedule", exact: true }),
    ).toBeDisabled();
    await dialog.getByLabel("Start").fill(tomorrowAt10());
    await dialog.getByLabel("Meeting link").fill("https://meet.example.com/x");
    const interviewers = dialog.getByRole("combobox", { name: "Interviewers" });
    const stranger = `nobody-${randomUUID()}@${org.domain}`;
    for (const email of [org.emailAddress, panelist.emailAddress, stranger]) {
      await interviewers.fill(email);
      await interviewers.press("Enter");
    }
    await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(
      dialog.getByText(/not active users of your Org/),
    ).toBeVisible();

    // Drop the unknown person and try again.
    // The tag exposes no role of its own, so its remove control is its child.
    await dialog.getByTitle(stranger).locator("xpath=./*").last().click();
    await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(page.getByText("Interview scheduled.").first()).toBeVisible();
    await expect(page.getByText("Interview 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Awaiting response").first()).toBeVisible();
    await expect(page.getByText(/60 min/)).toBeVisible();

    // Changing the details keeps the interview and its number.
    await page.getByRole("button", { name: "Change", exact: true }).click();
    const change = page.getByRole("dialog", { name: "Change the interview" });
    await change.getByLabel("Duration").fill("45");
    await change.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Interview updated.").first()).toBeVisible();
    await expect(page.getByText(/45 min/)).toBeVisible();
    expect(
      (await detailOf(api, owner, n, application)).interviews,
    ).toHaveLength(1);

    // Feedback is refused until the interview was held.
    await expect(
      page.getByRole("button", { name: "Give feedback" }),
    ).toHaveCount(0);

    // As if the start time had passed.
    applicationRowsSQL(
      org.domain,
      n,
      application,
      "org_interviews",
      "starts_at = now() - interval '1 hour'",
    );
    await page.reload();
    await page.getByRole("button", { name: "Mark completed" }).click();
    await page
      .getByRole("dialog", { name: /took place/ })
      .getByRole("button", { name: "Mark completed" })
      .click();
    await expect(
      page.getByText("Interview marked as completed."),
    ).toBeVisible();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();

    // The Opening's recruiter is an interviewer too and gives feedback first.
    await page.getByRole("button", { name: "Give feedback" }).click();
    const feedback = page.getByRole("dialog", {
      name: "Feedback on interview 1",
    });
    const submit = feedback.getByRole("button", { name: "Submit feedback" });
    await expect(submit).toBeDisabled();
    await feedback.getByRole("radio", { name: "Strong yes" }).check();
    await expect(submit).toBeDisabled();
    await feedback.getByLabel("Notes").fill("Strong systems design");
    await submit.click();
    await expect(page.getByText("Feedback submitted.").first()).toBeVisible();
    await expect(page.getByText("Strong systems design")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Give feedback" }),
    ).toHaveCount(0);

    // The other interviewer finds the interview under My interviews, sees
    // nothing of the recruiter's feedback, and none of the Org's offers.
    await signOut(page);
    await signIn(page, panelist);
    await page.goto(`${ORGS_PORTAL}/my-interviews`);
    await expect(page.getByText("Due")).toBeVisible();
    await page.getByRole("link", { name: "Ada Lovelace" }).click();
    await expect(page.getByText("Interview 1", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "Give your feedback to read the other interviewers' feedback.",
      ),
    ).toBeVisible();
    await expect(page.getByText("Strong systems design")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Schedule interview" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Extend offer" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Change" })).toHaveCount(0);

    await page.getByRole("button", { name: "Give feedback" }).click();
    const own = page.getByRole("dialog", { name: "Feedback on interview 1" });
    await own.getByRole("radio", { name: "No", exact: true }).check();
    await own.getByLabel("Notes").fill("Weak on testing");
    await own.getByRole("button", { name: "Submit feedback" }).click();
    await expect(page.getByText("Feedback submitted.").first()).toBeVisible();
    await expect(page.getByText("Strong systems design")).toBeVisible();

    // A second submission is refused by the API, not offered by the page.
    await expect(
      page.getByRole("button", { name: "Give feedback" }),
    ).toHaveCount(0);
    const stored = await detailOf(api, owner, n, application);
    expect(stored.interviews[0]?.feedback).toHaveLength(2);
  });
});

test("an interview is cancelled and an assessment result completes its stage", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening, stages } = await publishedOpening(api, owner, org, {
      stages: [...pipeline],
    });
    const n = opening.opening_number;
    const interviewed = await candidateAt(
      world,
      n,
      stageOf(stages, 2),
      "Grace Hopper",
    );
    const assessed = await candidateAt(
      world,
      n,
      stageOf(stages, 1),
      "Alan Turing",
    );
    await signIn(page, org);

    await page.goto(applicationURL(n, interviewed));
    await page.getByRole("button", { name: "Schedule interview" }).click();
    const dialog = page.getByRole("dialog", { name: "Schedule an interview" });
    await dialog.getByLabel("Start").fill(tomorrowAt10());
    await dialog.getByRole("radio", { name: "In person" }).check();
    await dialog.getByLabel("Location").fill("Room 4, second floor");
    const interviewers = dialog.getByRole("combobox", { name: "Interviewers" });
    await interviewers.fill(org.emailAddress);
    await interviewers.press("Enter");
    await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(page.getByText("Interview scheduled.").first()).toBeVisible();
    await expect(page.getByText("Room 4, second floor")).toBeVisible();

    await page.getByRole("button", { name: "Cancel interview" }).click();
    const confirm = page.getByRole("dialog", { name: "Cancel interview 1?" });
    await confirm.getByRole("button", { name: "Cancel interview" }).click();
    await expect(page.getByText("Interview cancelled.")).toBeVisible();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change" })).toHaveCount(0);

    await page.goto(applicationURL(n, assessed));
    await page
      .getByRole("button", { name: "Record assessment result" })
      .click();
    const record = page.getByRole("dialog", {
      name: "Assessment result: Exercise",
    });
    const save = record.getByRole("button", { name: "Record result" });
    await expect(save).toBeDisabled();
    await record.getByLabel("Report link").fill("not a link");
    await record.getByRole("radio", { name: "Pass" }).check();
    await expect(save).toBeDisabled();
    await record
      .getByLabel("Report link")
      .fill("https://reports.example.com/1");
    await record.getByLabel("Score (0–100)").fill("88");
    await record.getByLabel("Notes").fill("Clean solution");
    await save.click();
    await expect(page.getByText("Assessment result recorded.")).toBeVisible();
    await expect(page.getByText("Score 88")).toBeVisible();
    await expect(page.getByText("Clean solution")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Record assessment result" }),
    ).toHaveCount(0);
    const stored = await detailOf(api, owner, n, assessed);
    expect(stored.assessments[0]).toMatchObject({ outcome: "pass", score: 88 });
    expect(
      stored.stage_records.find((entry) => entry.stage.name === "Exercise")
        ?.status,
    ).toBe("completed");
  });
});

test("background-check consent is requested, asked again, and results are recorded after it", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening, stages } = await publishedOpening(api, owner, org, {
      stages: [...pipeline],
    });
    const n = opening.opening_number;
    const { number: application, applicant } = await candidateFor(
      world,
      n,
      stageOf(stages, 3),
    );
    // The applicant answers through the Hub.
    const answer = async (check: number, give: boolean) => {
      const body = {
        domain: org.domain,
        opening_number: n,
        application_number: application,
        check_number: check,
      };
      const options = {
        token: applicant.token,
        idempotencyKey: hubIdempotencyKey(),
      };
      const answered = give
        ? await applicant.hub.giveApplicationBackgroundCheckConsent(
            body,
            options,
          )
        : await applicant.hub.declineApplicationBackgroundCheckConsent(
            body,
            options,
          );
      expect(answered.status(), await answered.text()).toBe(200);
    };
    await signIn(page, org);
    await page.goto(applicationURL(n, application));

    await page
      .getByRole("button", { name: "Request background-check consent" })
      .click();
    const ask = page.getByRole("dialog", {
      name: "Request background-check consent",
    });
    const send = ask.getByRole("button", { name: "Send request" });
    await expect(send).toBeDisabled();
    await ask.getByRole("checkbox", { name: "Identity" }).click();
    await expect(ask.getByRole("checkbox", { name: "Identity" })).toBeChecked();
    await ask.getByRole("checkbox", { name: "Criminal record" }).click();
    await send.click();
    await expect(page.getByText("Consent requested.").first()).toBeVisible();
    await expect(page.getByText(/Waiting for the applicant/)).toBeVisible();
    // One request is active at a time, and nothing can be recorded yet.
    await expect(
      page.getByRole("button", { name: "Request background-check consent" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Record result" }),
    ).toHaveCount(0);

    // The applicant declined: the Org may ask again.
    await answer(1, false);
    await page.reload();
    await expect(page.getByText("Consent declined").first()).toBeVisible();
    await page.getByRole("button", { name: "Ask for consent again" }).click();
    const again = page.getByRole("dialog", {
      name: "Ask for background-check consent again",
    });
    await again.getByRole("checkbox", { name: "Drug test" }).click();
    await again.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Consent requested.").first()).toBeVisible();

    // The applicant agreed: each requested check can be recorded once.
    await answer(2, true);
    await page.reload();
    await expect(page.getByText("Consent given").first()).toBeVisible();
    await page.getByRole("button", { name: "Record result" }).click();
    const result = page.getByRole("dialog", { name: "Result: Drug test" });
    await result.getByRole("radio", { name: "Discrepancy" }).check();
    await result.getByLabel("Notes").fill("Needs a second look");
    await result.getByRole("button", { name: "Record result" }).click();
    await expect(page.getByText("Drug test result recorded.")).toBeVisible();
    await expect(page.getByText("Needs a second look")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Record result" }),
    ).toHaveCount(0);
    await expect(
      page.getByText(/it never decides what to do about them/).first(),
    ).toBeVisible();
    const stored = await detailOf(api, owner, n, application);
    expect(stored.background_checks[1]?.results[0]).toMatchObject({
      check_type: "drug",
      outcome: "discrepancy",
    });
  });
});

test("an offer is extended with a letter, withdrawn, and extended again", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening, stages } = await publishedOpening(api, owner, org, {
      stages: [...pipeline],
      positions: 1,
    });
    const n = opening.opening_number;
    await seedApplication(world, n, {
      name: "Already Joined",
      state: "joined",
      joinedOn: utcDate(-30),
      stageId: stageOf(stages, 2).id,
    });
    const application = await candidateAt(
      world,
      n,
      stageOf(stages, 2),
      "Margaret Hamilton",
    );
    await signIn(page, org);
    await page.goto(applicationURL(n, application));

    await page.getByRole("button", { name: "Extend offer" }).click();
    const dialog = page.getByRole("dialog", { name: "Extend an offer" });
    await expect(
      dialog.getByText(/1 people have already joined against 1 planned/),
    ).toBeVisible();
    const extend = dialog.getByRole("button", { name: "Extend offer" });
    await expect(extend).toBeDisabled();

    // A file that is not a PDF is refused before it is uploaded.
    const chooser = dialog.locator('input[type="file"]');
    await chooser.setInputFiles({
      name: "letter.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a pdf"),
    });
    await expect(
      dialog.getByText("The offer letter must be a PDF file."),
    ).toBeVisible();
    await expect(extend).toBeDisabled();

    await chooser.setInputFiles({
      name: "offer.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(`%PDF-1.4\n% ${randomUUID()}\n%%EOF\n`),
    });
    await expect(dialog.getByText("offer.pdf")).toBeVisible();
    await dialog.getByLabel("Respond within").fill("7");
    await dialog.getByLabel("Proposed joining date").fill(utcDate(30));
    await extend.click();
    await expect(page.getByText("Offer extended.").first()).toBeVisible();
    await expect(page.getByText("Offer 1")).toBeVisible();
    await expect(page.getByText("Extended", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Offer letter (PDF)" }),
    ).toHaveAttribute("href", /.+/);
    await expect(
      page.getByRole("button", { name: "Extend offer" }),
    ).toHaveCount(0);
    const offered = await detailOf(api, owner, n, application);
    expect(offered.state).toBe("offered");
    expect(offered.offers[0]).toMatchObject({
      status: "extended",
      proposed_joining_date: utcDate(30),
    });

    await page.getByRole("button", { name: "Withdraw offer" }).click();
    const confirm = page.getByRole("dialog", { name: "Withdraw the offer?" });
    await confirm.getByRole("button", { name: "Withdraw offer" }).click();
    await expect(page.getByText("Offer withdrawn.")).toBeVisible();
    await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
    // The withdrawn offer and its letter stay listed; a new one can follow.
    await expect(
      page.getByRole("link", { name: "Offer letter (PDF)" }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Extend offer" }),
    ).toBeVisible();
    expect((await detailOf(api, owner, n, application)).state).toBe(
      "in_pipeline",
    );
  });
});
