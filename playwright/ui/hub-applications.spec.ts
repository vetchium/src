import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import type { ApplicationQuestion } from "typespec/common/openings";
import type { PipelineStage } from "typespec/orgs/hiring/pipelines";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { ApplicationStateConflictError } from "typespec/problem/hub/applications";
import { OrgUnavailableError } from "typespec/problem/hub/openings";
import {
  hubUserDIDForHandle,
  sqlLiteral,
  sqlScalarForTenant,
} from "../lib/admin-db.ts";
import { loginOrg, OrgsAPI, orgDID, orgSQL } from "../lib/orgs-api.ts";
import {
  detailOf,
  openingContent,
  publishedOpening,
  stageOf,
  utcDate,
} from "../lib/orgs-applications.ts";
import { HUB_PORTAL } from "../lib/portals.ts";
import {
  chooseRegion,
  expect,
  type HubTestUser,
  type OrgTestOrg,
  test,
} from "../lib/region-ui.ts";

test.describe.configure({ timeout: 180_000 });

const pipeline = [
  { name: "Screen", kind: "review" },
  { name: "Panel", kind: "interview" },
  { name: "Checks", kind: "background_check" },
] as const;

async function signIn(page: Page, user: HubTestUser) {
  await page.goto(`${HUB_PORTAL}/login?region=sgp`);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await chooseRegion(page, "sgp");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: /Welcome back/ }),
  ).toBeVisible();
}

interface World {
  api: OrgsAPI;
  org: OrgTestOrg;
  owner: string;
  opening: number;
  title: string;
  stages: PipelineStage[];
  applicant: HubTestUser;
}

/** Removes the commands, outbox events, and inbox rows the applicant's
 * applications left in the sgp tenant, which hosts both sides. */
function cleanupFederation(applicant: HubTestUser, domain: string) {
  const did = hubUserDIDForHandle(applicant.handle);
  const commandIDs = sqlScalarForTenant(
    "sgp",
    `SELECT coalesce(string_agg(quote_literal(command_id::text), ','), '')
     FROM vetchium.federation_operations
     WHERE owner_principal_type = 'hub_user'
       AND owner_principal_id = ${sqlLiteral(did)}`,
  );
  const aggregates = sqlLiteral(`${orgDID(domain, "sgp")}:%`);
  sqlScalarForTenant(
    "sgp",
    `${
      commandIDs === ""
        ? ""
        : `DELETE FROM vetchium.federation_command_ledger
           WHERE command_id::text IN (${commandIDs});`
    }
     DELETE FROM vetchium.federation_outbox
     WHERE destination_principal_did = ${sqlLiteral(did)}::uuid;
     DELETE FROM vetchium.audit_events
     WHERE entity_type = 'federation_event' AND entity_id IN (
       SELECT event_id::text FROM vetchium.federation_inbox
       WHERE aggregate_type = 'org_application'
         AND aggregate_id LIKE ${aggregates});
     DELETE FROM vetchium.federation_inbox
     WHERE aggregate_type = 'org_application'
       AND aggregate_id LIKE ${aggregates};
     DELETE FROM vetchium.federation_event_watermarks
     WHERE destination_principal_did = ${sqlLiteral(did)}::uuid;`,
  );
}

/** A published Opening of a new Org and a signed-up Hub user, in sgp. */
async function withWorld(
  request: APIRequestContext,
  hubUser: (tenant: "sgp") => Promise<HubTestUser>,
  org: (tenant: "sgp") => Promise<OrgTestOrg>,
  body: (world: World) => Promise<void>,
  questions?: ApplicationQuestion[],
) {
  const signedUp = await org("sgp");
  const api = new OrgsAPI(request, "sgp");
  const owner = await loginOrg(api, signedUp);
  const title = `Engineer ${randomUUID().slice(0, 8)}`;
  const { opening, stages } = await publishedOpening(api, owner, signedUp, {
    title,
    stages: [...pipeline],
    ...(questions && { questions }),
  });
  const applicant = await hubUser("sgp");
  try {
    await body({
      api,
      org: signedUp,
      owner,
      opening: opening.opening_number,
      title,
      stages,
      applicant,
    });
  } finally {
    cleanupFederation(applicant, signedUp.domain);
    orgSQL(
      `DELETE FROM vetchium.federation_outbox
       WHERE aggregate_type = 'org_application'
         AND aggregate_id LIKE ${sqlLiteral(`${orgDID(signedUp.domain, "sgp")}:%`)}`,
    );
  }
}

function openingURL(world: World): string {
  return `${HUB_PORTAL}/org/${world.org.domain}/openings/${world.opening}`;
}

/** Applies through the portal and returns the application number. */
async function applyInPortal(page: Page, world: World, note?: string) {
  await page.goto(openingURL(world));
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Apply" })).toBeVisible();
  if (note !== undefined) await page.getByLabel("Cover note").fill(note);
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByRole("heading", { name: world.title })).toBeVisible();
  const number = Number(new URL(page.url()).pathname.split("/").pop());
  expect(number).toBeGreaterThanOrEqual(1);
  return number;
}

async function shortlistTo(
  world: World,
  application: number,
  stage: PipelineStage,
) {
  const response = await world.api.shortlistApplication(world.owner, {
    opening_number: world.opening,
    application_number: application,
    version: (
      await detailOf(world.api, world.owner, world.opening, application)
    ).version,
    stage_id: stage.id,
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function version(world: World, application: number): Promise<number> {
  return (await detailOf(world.api, world.owner, world.opening, application))
    .version;
}

async function scheduleInterview(
  world: World,
  application: number,
  days: number,
) {
  const start = new Date();
  start.setDate(start.getDate() + days);
  start.setHours(10, 0, 0, 0);
  const response = await world.api.scheduleInterview(world.owner, {
    opening_number: world.opening,
    application_number: application,
    version: await version(world, application),
    start_time: start.toISOString(),
    duration_minutes: 45,
    mode: "video",
    video_url: "https://meet.example.com/room",
    interviewer_emails: [world.org.emailAddress],
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function extendOffer(world: World, application: number) {
  const letter = Buffer.from(
    `%PDF-1.4\n% ${randomUUID()}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`,
  );
  const uploaded = await world.api.uploadOfferLetter(world.owner, letter);
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  const { letter_id } = (await uploaded.json()) as { letter_id: string };
  const extended = await world.api.extendApplicationOffer(world.owner, {
    opening_number: world.opening,
    application_number: application,
    version: await version(world, application),
    letter_id,
    proposed_joining_date: utcDate(30),
    respond_within_days: 14,
  });
  expect(extended.status(), await extended.text()).toBe(200);
}

function applicationURL(world: World, application: number): string {
  return `${HUB_PORTAL}/applications/${world.org.domain}/${world.opening}/${application}`;
}

test("a Hub user applies from the Opening page and finds the application", async ({
  page,
  request,
  hubUser,
  org,
}) => {
  await withWorld(request, hubUser, org, async (world) => {
    await signIn(page, world.applicant);
    await page.goto(openingURL(world));
    await expect(
      page.getByRole("button", { name: "Apply", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Apply", exact: true }).click();

    // What the Org will see, and that the note is optional.
    await expect(page.getByText(/^What .* will see$/)).toBeVisible();
    await expect(page.getByText(world.applicant.displayName)).toBeVisible();
    await expect(
      page.getByText(/never shared/, { exact: false }),
    ).toBeVisible();
    await page.getByLabel("Cover note").fill("I like reliable services.");
    await page.getByRole("button", { name: "Submit application" }).click();

    await expect(
      page.getByRole("heading", { name: world.title }),
    ).toBeVisible();
    await expect(
      page.getByText("Applied", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Nothing needs your answer right now."),
    ).toBeVisible();
    const number = Number(new URL(page.url()).pathname.split("/").pop());
    const stored = await detailOf(
      world.api,
      world.owner,
      world.opening,
      number,
    );
    expect(stored.cover_note).toBe("I like reliable services.");

    // The Opening now says so, and applying again is refused.
    // The projection trails the Org's tenant briefly.
    await page.goto(openingURL(world));
    await expect(async () => {
      await page.reload();
      await expect(page.getByText("You applied to this opening.")).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 30_000 });
    await expect(
      page.getByRole("button", { name: "Apply", exact: true }),
    ).toHaveCount(0);
    await page.goto(`${openingURL(world)}/apply`);
    await expect(
      page.getByText("You already applied to this opening."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit application" }),
    ).toHaveCount(0);

    // The list keeps its tab in the URL.
    await page.goto(`${HUB_PORTAL}/applications`);
    await expect(page.getByRole("tab", { name: "Active (1)" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Closed (0)" })).toBeVisible();
    await expect(page.getByRole("link", { name: world.title })).toBeVisible();
    await page.getByRole("tab", { name: "Closed (0)" }).click();
    await expect(page).toHaveURL(/tab=closed/);
    await expect(page.getByText("No closed applications yet.")).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("tab", { name: "Closed (0)", selected: true }),
    ).toBeVisible();
  });
});

test("a pending apply is polled and replayed with the same idempotency key", async ({
  page,
  request,
  hubUser,
  org,
}) => {
  await withWorld(request, hubUser, org, async (world) => {
    await signIn(page, world.applicant);
    const keys: (string | undefined)[] = [];
    let pendingSent = false;
    await page.route("**/api/hub/apply-to-opening", async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      if (pendingSent) {
        await route.continue();
        return;
      }
      pendingSent = true;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({ operation_id: randomUUID() }),
      });
    });
    await page.route("**/api/hub/operations/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          operation_id: randomUUID(),
          state: "succeeded",
        }),
      });
    });
    await page.goto(`${openingURL(world)}/apply`);
    await page.getByRole("button", { name: "Submit application" }).click();
    await expect(
      page.getByRole("heading", { name: world.title }),
    ).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });
});

test("an Opening that stopped taking applications offers no Apply", async ({
  page,
  request,
  hubUser,
  org,
}) => {
  await withWorld(request, hubUser, org, async (world) => {
    const fresh = await world.api.getOpening(world.owner, {
      opening_number: world.opening,
    });
    const current = ((await fresh.json()) as { version: number }).version;
    const closed = await world.api.requestOpeningChange(world.owner, {
      opening_number: world.opening,
      version: current,
      kind: "close",
    });
    expect(closed.status(), await closed.text()).toBe(200);
    await signIn(page, world.applicant);
    await page.goto(openingURL(world));
    await expect(
      page.getByText("This opening is not accepting applications."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Apply", exact: true }),
    ).toHaveCount(0);
    await page.goto(`${openingURL(world)}/apply`);
    await expect(
      page.getByText("This opening is not accepting applications."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit application" }),
    ).toHaveCount(0);
  });
});

test("an interview is accepted or another time is requested", async ({
  page,
  request,
  hubUser,
  org,
}) => {
  await withWorld(request, hubUser, org, async (world) => {
    await signIn(page, world.applicant);
    const application = await applyInPortal(page, world);
    await shortlistTo(world, application, stageOf(world.stages, 1));
    await scheduleInterview(world, application, 2);
    await scheduleInterview(world, application, 3);

    // The list reads the home tenant's projection, which trails the Org's
    // tenant briefly.
    await page.goto(`${HUB_PORTAL}/applications`);
    await expect(async () => {
      await page.reload();
      await expect(page.getByText("Respond to an interview")).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 30_000 });
    await expect(
      page
        .getByRole("menuitem", { name: /Applications/ })
        .getByTitle("1 application needs your answer"),
    ).toBeVisible();
    await page.goto(`${HUB_PORTAL}/`);
    await expect(
      page.getByText("1 application is waiting for your answer."),
    ).toBeVisible();

    await page.goto(applicationURL(world, application));
    await expect(
      page.getByText("Interviewing", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Interview 1")).toBeVisible();
    await expect(page.getByText("Interview 2")).toBeVisible();

    // Accept the first interview.
    const first = page.locator(".ant-card", { hasText: "Interview 1" }).last();
    await first.getByRole("button", { name: "Accept" }).click();
    await expect(first.getByText("Accepted")).toBeVisible();
    await expect(first.getByRole("button", { name: "Accept" })).toHaveCount(0);

    // Ask for another time for the second: a note is required.
    const second = page.locator(".ant-card", { hasText: "Interview 2" }).last();
    await second.getByRole("button", { name: "Request another time" }).click();
    const dialog = page.getByRole("dialog", { name: "Request another time" });
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(
      dialog.getByText("Enter a note of 1 to 500 characters."),
    ).toBeVisible();
    await dialog
      .getByLabel("Note to the organization")
      .fill("Mornings suit me better.");
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(second.getByText("Another time requested")).toBeVisible();
    await expect(
      second.getByText("Your note: Mornings suit me better."),
    ).toBeVisible();

    const stored = await detailOf(
      world.api,
      world.owner,
      world.opening,
      application,
    );
    expect(
      stored.interviews.map((interview) => interview.applicant_response),
    ).toEqual(["accepted", "reschedule_requested"]);
  });
});

test("background-check consent is declined after a confirmation, or given", async ({
  page,
  request,
  hubUser,
  org,
}) => {
  await withWorld(request, hubUser, org, async (world) => {
    await signIn(page, world.applicant);
    const application = await applyInPortal(page, world);
    await shortlistTo(world, application, stageOf(world.stages, 2));
    const requested = await world.api.requestBackgroundCheckConsent(
      world.owner,
      {
        opening_number: world.opening,
        application_number: application,
        version: await version(world, application),
        check_types: ["identity", "employment"],
      },
    );
    expect(requested.status(), await requested.text()).toBe(200);

    await page.goto(applicationURL(world, application));
    const card = page.locator(".ant-card", {
      hasText: "Background check consent",
    });
    await expect(card.getByText("Identity")).toBeVisible();
    await expect(card.getByText("Employment")).toBeVisible();

    // Leaving the dialog changes nothing.
    await card.getByRole("button", { name: "Decline" }).click();
    const dialog = page.getByRole("dialog", { name: "Decline consent?" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(
      card.getByRole("button", { name: "Give consent" }),
    ).toBeVisible();

    await card.getByRole("button", { name: "Give consent" }).click();
    await expect(page.getByText("Background check consent")).toHaveCount(0);
    const stored = await detailOf(
      world.api,
      world.owner,
      world.opening,
      application,
    );
    expect(JSON.stringify(stored)).toContain("given");
  });
});

test("consent can be declined, which records nothing", async ({
  page,
  request,
  hubUser,
  org,
}) => {
  await withWorld(request, hubUser, org, async (world) => {
    await signIn(page, world.applicant);
    const application = await applyInPortal(page, world);
    await shortlistTo(world, application, stageOf(world.stages, 2));
    const requested = await world.api.requestBackgroundCheckConsent(
      world.owner,
      {
        opening_number: world.opening,
        application_number: application,
        version: await version(world, application),
        check_types: ["identity"],
      },
    );
    expect(requested.status(), await requested.text()).toBe(200);

    await page.goto(applicationURL(world, application));
    await page
      .locator(".ant-card", { hasText: "Background check consent" })
      .getByRole("button", { name: "Decline" })
      .click();
    await page
      .getByRole("dialog", { name: "Decline consent?" })
      .getByRole("button", { name: "Decline" })
      .click();
    await expect(page.getByText("Background check consent")).toHaveCount(0);
  });
});

test("an offer is accepted after a confirmation, and the application is withdrawn", async ({
  page,
  request,
  hubUser,
  org,
}) => {
  await withWorld(request, hubUser, org, async (world) => {
    await signIn(page, world.applicant);
    const application = await applyInPortal(page, world);
    await shortlistTo(world, application, stageOf(world.stages, 1));
    await extendOffer(world, application);

    await page.goto(applicationURL(world, application));
    await expect(
      page.getByText("Offer", { exact: true }).first(),
    ).toBeVisible();
    const card = page.locator(".ant-card", {
      hasText: "Proposed joining date",
    });
    await expect(card.getByText("Needs your answer")).toBeVisible();
    await expect(
      card.getByRole("button", { name: "View offer letter" }),
    ).toBeVisible();

    await card.getByRole("button", { name: "Accept offer" }).click();
    const dialog = page.getByRole("dialog", { name: "Accept this offer?" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(
      card.getByRole("button", { name: "Accept offer" }),
    ).toBeVisible();
    await card.getByRole("button", { name: "Accept offer" }).click();
    await page
      .getByRole("dialog", { name: "Accept this offer?" })
      .getByRole("button", { name: "Accept offer" })
      .click();
    await expect(card.getByText("Accepted")).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Decline offer" }),
    ).toHaveCount(0);

    // Withdrawing asks first and says the Opening cannot be applied to again.
    await page.getByRole("button", { name: "Withdraw application" }).click();
    const withdraw = page.getByRole("dialog", {
      name: "Withdraw this application?",
    });
    await expect(
      withdraw.getByText("You can't apply to this opening again."),
    ).toBeVisible();
    await withdraw.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByRole("button", { name: "Withdraw application" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Withdraw application" }).click();
    await page
      .getByRole("dialog", { name: "Withdraw this application?" })
      .getByRole("button", { name: "Withdraw application" })
      .click();
    await expect(page).toHaveURL(/\/applications\?tab=closed/);
    // The list reads the projection, which trails the Org's tenant briefly.
    await expect(async () => {
      await page.reload();
      await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 30_000 });

    await page.goto(`${openingURL(world)}/apply`);
    await expect(
      page.getByText("You already applied to this opening."),
    ).toBeVisible();
  });
});

test("an unreachable Org shows a retry state, and the retry succeeds", async ({
  page,
  request,
  hubUser,
  org,
}) => {
  await withWorld(request, hubUser, org, async (world) => {
    await signIn(page, world.applicant);
    const application = await applyInPortal(page, world);
    let unavailable = true;
    await page.route("**/api/hub/get-my-application", async (route) => {
      if (!unavailable) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify(OrgUnavailableError),
      });
    });
    await page.goto(applicationURL(world, application));
    await expect(
      page.getByText(/This organization is temporarily unavailable/),
    ).toBeVisible();
    unavailable = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(
      page.getByRole("heading", { name: world.title }),
    ).toBeVisible();
  });
});

test("the emailed Applications link opens the page and explains another region's link", async ({
  page,
  request,
  hubUser,
  org,
}) => {
  await withWorld(request, hubUser, org, async (world) => {
    await signIn(page, world.applicant);
    await page.goto(`${HUB_PORTAL}/applications?region=sgp`);
    await expect(
      page.getByRole("heading", { name: "Applications", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText(/This link is for an account in another region/),
    ).toHaveCount(0);
    await page.goto(`${HUB_PORTAL}/applications?region=deu`);
    await expect(
      page.getByText(/This link is for an account in another region/),
    ).toBeVisible();
  });
});

test("an application that does not exist, or changed under a withdrawal, is explained", async ({
  page,
  request,
  hubUser,
  org,
}) => {
  await withWorld(request, hubUser, org, async (world) => {
    await signIn(page, world.applicant);
    const application = await applyInPortal(page, world);

    await page.goto(applicationURL(world, application + 100));
    await expect(page.getByText("Application not found.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "All applications" }),
    ).toBeVisible();

    await page.route("**/api/hub/withdraw-application", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        body: JSON.stringify(ApplicationStateConflictError),
      });
    });
    await page.goto(applicationURL(world, application));
    await page.getByRole("button", { name: "Withdraw application" }).click();
    await page
      .getByRole("dialog", { name: "Withdraw this application?" })
      .getByRole("button", { name: "Withdraw application" })
      .click();
    await expect(
      page.getByText(/changed in the meantime and can no longer be withdrawn/),
    ).toBeVisible();
    await expect(page).toHaveURL(applicationURL(world, application));
  });
});

test("an offer is declined after a confirmation that says it cannot be undone", async ({
  page,
  request,
  hubUser,
  org,
}) => {
  await withWorld(request, hubUser, org, async (world) => {
    await signIn(page, world.applicant);
    const application = await applyInPortal(page, world);
    await shortlistTo(world, application, stageOf(world.stages, 1));
    await extendOffer(world, application);

    await page.goto(applicationURL(world, application));
    const card = page.locator(".ant-card", {
      hasText: "Proposed joining date",
    });
    await card.getByRole("button", { name: "Decline offer" }).click();
    const dialog = page.getByRole("dialog", { name: "Decline this offer?" });
    await expect(dialog.getByText(/This can't be undone\./)).toBeVisible();
    await dialog.getByRole("button", { name: "Decline offer" }).click();
    await expect(card.getByText("Declined")).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Accept offer" }),
    ).toHaveCount(0);
  });
});

const everyType: ApplicationQuestion[] = [
  { text: "Current role", type: "short_text", required: true },
  { text: "Why this team", type: "long_text", required: false },
  { text: "Years of Go", type: "number", required: true, min: 1, max: 40 },
  { text: "Can you relocate", type: "yes_no", required: true },
  {
    text: "Preferred office",
    type: "single_choice",
    required: true,
    options: ["Singapore", "Remote"],
  },
  {
    text: "Languages",
    type: "multiple_choice",
    required: false,
    options: ["Go", "TypeScript", "Rust"],
  },
];

test("a Hub user answers every type of question within its bounds and reads the answers", async ({
  page,
  request,
  hubUser,
  org,
}) => {
  await withWorld(
    request,
    hubUser,
    org,
    async (world) => {
      await signIn(page, world.applicant);
      await page.goto(`${openingURL(world)}/apply`);
      await expect(page.getByText(/^Questions from /)).toBeVisible();

      // Required questions block the submit until answered.
      await page.getByRole("button", { name: "Submit application" }).click();
      await expect(page.getByText("Answer this question.")).toHaveCount(4);

      await page.getByLabel("Current role").fill("  Platform engineer  ");
      const years = page.getByLabel("Years of Go");
      await expect(page.getByText("From 1 to 40")).toBeVisible();
      await years.fill("50");
      await years.blur();
      await expect(years).toHaveValue("40");
      await years.fill("0");
      await years.blur();
      await expect(years).toHaveValue("1");
      await years.fill("6.6");
      await years.blur();
      await expect(years).toHaveValue("7");
      await page
        .getByRole("radiogroup", { name: "Can you relocate" })
        .getByText("No", { exact: true })
        .click();
      await page
        .getByRole("radiogroup", { name: "Preferred office" })
        .getByText("Remote", { exact: true })
        .click();
      const languages = page.getByRole("group", { name: "Languages" });
      await languages.getByText("Go", { exact: true }).click();
      await languages.getByText("Rust", { exact: true }).click();
      await expect(page.getByText("Answer this question.")).toHaveCount(0);
      await page.getByRole("button", { name: "Submit application" }).click();

      await expect(
        page.getByRole("heading", { name: world.title }),
      ).toBeVisible();
      const number = Number(new URL(page.url()).pathname.split("/").pop());
      const stored = await detailOf(
        world.api,
        world.owner,
        world.opening,
        number,
      );
      expect(stored.answers.map((answered) => answered.answer)).toEqual([
        "Platform engineer",
        undefined,
        7,
        false,
        "Remote",
        ["Go", "Rust"],
      ]);

      await expect(
        page.getByText("Your answers", { exact: true }),
      ).toBeVisible();
      const answerOf = (text: string) =>
        page.getByRole("region", { name: text, exact: true });
      await expect(answerOf("Current role")).toContainText("Platform engineer");
      await expect(answerOf("Why this team")).toContainText("Not answered");
      await expect(answerOf("Years of Go")).toContainText("7");
      await expect(answerOf("Can you relocate")).toContainText("No");
      await expect(answerOf("Preferred office")).toContainText("Remote");
      await expect(answerOf("Languages")).toContainText("Go, Rust");
    },
    everyType,
  );
});

test("answers refused after the Org revised its questions are kept where they fit", async ({
  page,
  request,
  hubUser,
  org,
}) => {
  await withWorld(
    request,
    hubUser,
    org,
    async (world) => {
      await signIn(page, world.applicant);
      await page.goto(`${openingURL(world)}/apply`);
      await page.getByLabel("Current role").fill("Platform engineer");
      await page
        .getByRole("radiogroup", { name: "Preferred office" })
        .getByText("Remote", { exact: true })
        .click();

      // The Org drops the chosen option and adds a required question while
      // the page is open.
      const read = await world.api.getOpening(world.owner, {
        opening_number: world.opening,
      });
      expect(read.status(), await read.text()).toBe(200);
      const live = (await read.json()) as OrgOpening;
      const [role, office] = live.live_content?.questions ?? [];
      if (role === undefined || office === undefined)
        throw new Error("the Opening lost its questions");
      const saved = await world.api.saveOpeningWorkingCopy(world.owner, {
        opening_number: world.opening,
        version: live.version,
        content: {
          ...openingContent(world.title),
          questions: [
            role,
            { ...office, options: ["Singapore", "Hybrid"] },
            { text: "Can you relocate", type: "yes_no", required: true },
          ],
        },
      });
      expect(saved.status(), await saved.text()).toBe(200);
      const revised = await world.api.requestOpeningChange(world.owner, {
        opening_number: world.opening,
        version: ((await saved.json()) as { version: number }).version,
        kind: "revise",
      });
      expect(revised.status(), await revised.text()).toBe(200);

      await page.getByRole("button", { name: "Submit application" }).click();
      await expect(page.getByText("The questions changed")).toBeVisible();
      await expect(page.getByLabel("Current role")).toHaveValue(
        "Platform engineer",
      );
      const changed = /changed this question\. Check your answer\.$/;
      await expect(page.getByText(changed)).toHaveCount(2);
      const offices = page.getByRole("radiogroup", {
        name: "Preferred office",
      });
      await expect(offices.getByRole("radio", { checked: true })).toHaveCount(
        0,
      );
      await offices.getByText("Hybrid", { exact: true }).click();
      await expect(page.getByText(changed)).toHaveCount(1);
      await page
        .getByRole("radiogroup", { name: "Can you relocate" })
        .getByText("Yes", { exact: true })
        .click();
      await page.getByRole("button", { name: "Submit application" }).click();

      await expect(
        page.getByRole("heading", { name: world.title }),
      ).toBeVisible();
      const number = Number(new URL(page.url()).pathname.split("/").pop());
      const stored = await detailOf(
        world.api,
        world.owner,
        world.opening,
        number,
      );
      expect(stored.answers.map((answered) => answered.answer)).toEqual([
        "Platform engineer",
        "Hybrid",
        true,
      ]);
    },
    [
      { text: "Current role", type: "short_text", required: true },
      {
        text: "Preferred office",
        type: "single_choice",
        required: true,
        options: ["Singapore", "Remote"],
      },
    ],
  );
});
