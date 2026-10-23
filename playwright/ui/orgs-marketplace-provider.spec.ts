import { readFile } from "node:fs/promises";
import { expect, test } from "../lib/admin-fixtures.ts";
import { orgSQL } from "../lib/orgs-api.ts";
import {
  activate,
  asProvider,
  propose,
  withPair,
  withProvider,
} from "../lib/orgs-marketplace.ts";
import {
  assign,
  candidate,
  route,
  routed,
  withWorld,
} from "../lib/orgs-routing.ts";
import { signIn } from "../lib/orgs-ui.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";

test.describe.configure({ timeout: 180_000 });

test("shows the plan gate on /listings when on the Free plan", async ({
  page,
  request,
}) => {
  await withProvider(
    request,
    async ({ org, tenant }) => {
      await signIn(page, org, tenant);
      await page.goto(`${ORGS_PORTAL}/listings`);
      await expect(
        page.getByRole("heading", {
          name: "Marketplace listings require a Silver plan or higher",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Compare plans" }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Compare plans" }).click();
      await expect(page).toHaveURL(`${ORGS_PORTAL}/plans`);
    },
    { silver: false },
  );
});

test("creates, edits, publishes, and unlists a service listing", async ({
  page,
  request,
}) => {
  await withProvider(
    request,
    async ({ org, tenant }) => {
      await signIn(page, org, tenant);
      await page.goto(`${ORGS_PORTAL}/listings`);
      await expect(
        page.getByRole("heading", { name: "Listings", exact: true }),
      ).toBeVisible();

      // Click "Create listing" on the Sourcing card
      const sourcingCard = page.locator(".ant-card", { hasText: "Sourcing" });
      await sourcingCard
        .getByRole("button", { name: "Create listing" })
        .click();
      await expect(page).toHaveURL(`${ORGS_PORTAL}/listings/sourcing`);

      // Fill in listing details
      await page
        .getByPlaceholder(
          "E.g., Global Executive Technical Interviewing & Assessment",
        )
        .fill("Global Talent Sourcing");
      await page
        .getByPlaceholder(
          "Describe your methodology, team credentials, turnaround time",
          { exact: false },
        )
        .fill("We find high-impact engineering candidates globally.");
      await page
        .getByPlaceholder("E.g., $150 per interview", { exact: false })
        .fill("15% placement fee");

      // Select a language
      const languagesSelect = page
        .locator(".ant-select")
        .filter({ hasText: "Select languages" });
      await languagesSelect.click();
      await page
        .locator(".ant-select-dropdown:visible .ant-select-item-option-content")
        .first()
        .click();

      // Save as draft first
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page).toHaveURL(`${ORGS_PORTAL}/listings`);

      // Verify card now shows Draft tag and Publish button
      await expect(
        sourcingCard.getByText("Draft", { exact: true }),
      ).toBeVisible();

      // Publish the listing
      await sourcingCard.getByRole("button", { name: "Publish" }).click();
      await expect(
        sourcingCard.getByText("Listed", { exact: true }),
      ).toBeVisible();

      // Unlist the listing
      await sourcingCard.getByRole("button", { name: "Unlist" }).click();
      const unlistDialog = page.getByRole("dialog");
      await expect(unlistDialog).toBeVisible();
      await unlistDialog
        .getByRole("button", { name: "Unlist", exact: true })
        .click();
      await expect(unlistDialog).toBeHidden();
      await expect(
        sourcingCard.getByText("Unlisted", { exact: true }),
      ).toBeVisible();
    },
    { silver: true },
  );
});

test("accepts a client proposal, edits own reference, exports statement CSV, and ends engagement", async ({
  page,
  request,
}) => {
  await withPair(request, { capabilities: ["interviewing"] }, async (pair) => {
    const proposed = await propose(
      pair,
      "interviewing",
      "We want to partner with your team on technical interviews.",
    );
    await asProvider(pair, proposed.id, 1);

    await signIn(page, pair.provider.org, pair.provider.tenant);

    // Open Clients page
    await page.goto(`${ORGS_PORTAL}/clients`);
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();

    // Pending proposal is visible under awaiting decision
    await expect(page.getByText(pair.consumer.org.domain)).toBeVisible();
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByText("Engagement proposal accepted.")).toBeVisible();
    await asProvider(pair, proposed.id, 2);

    // Navigate to engagement detail
    await page.goto(`${ORGS_PORTAL}/clients/${proposed.id}`);
    await expect(page.getByText("Active", { exact: true })).toBeVisible();

    // Edit provider reference
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByPlaceholder("PO-2026-…").fill("PROV-REF-99");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("PROV-REF-99")).toBeVisible();

    // Export statement CSV
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const file = await (await download).path();
    const content = await readFile(file, "utf8");
    expect(content).toContain("Event time (UTC)");

    // End engagement with note
    await page
      .getByRole("button", { name: "End engagement", exact: true })
      .click();
    const endModal = page.getByRole("dialog");
    await expect(endModal).toBeVisible();
    await endModal.locator("textarea").fill("Service completed successfully.");
    await endModal
      .getByRole("button", { name: "End engagement", exact: true })
      .click();
    await expect(page.getByText("Ended", { exact: true })).toBeVisible();
  });
});

test("schedules and gives feedback on routed interview work", async ({
  page,
  request,
}) => {
  await withWorld(request, async (world) => {
    const interview = await activate(world.pair, "interviewing");
    await assign(world, interview.id, world.panel);
    const appDetail = await candidate(world, world.panel, "Margaret Hamilton");
    await route(world, appDetail, interview.id);

    await signIn(page, world.pair.provider.org, world.pair.provider.tenant);

    // Open Work queue page
    await page.goto(`${ORGS_PORTAL}/work`);
    await expect(
      page.getByRole("heading", { name: "Work queue" }),
    ).toBeVisible();

    // Margaret Hamilton is visible in the work queue table
    await expect(page.getByText("Margaret Hamilton")).toBeVisible();
    await page.getByRole("button", { name: "View" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/work/${interview.id}/[0-9a-f-]{36}`),
    );

    // Snapshot and stage information
    await expect(page.getByText("Margaret Hamilton")).toBeVisible();
    await expect(page.getByText("Panel")).toBeVisible();

    // Schedule interview
    await page.getByRole("button", { name: "Schedule interview" }).click();
    const scheduleModal = page.getByRole("dialog");
    await expect(scheduleModal).toBeVisible();

    const tomorrow = new Date(Date.now() + 24 * 3600_000);
    const startStr = tomorrow.toISOString().slice(0, 16);
    await scheduleModal.locator('input[type="datetime-local"]').fill(startStr);
    await scheduleModal
      .getByPlaceholder("https://meet.…")
      .fill("https://meet.example.test/panel");
    await scheduleModal
      .getByRole("button", { name: "Schedule interview" })
      .click();
    await expect(page.getByText("Interview scheduled.")).toBeVisible();
    await expect(scheduleModal).toBeHidden();

    // Verify interview appears as scheduled
    await expect(page.getByText("Interview #1")).toBeVisible();
    await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();

    // Advance time past interview start so outcome can be recorded
    orgSQL(
      `UPDATE vetchium.org_interviews SET starts_at = now() - interval '1 hour'
       WHERE performer_engagement_id = '${interview.id}'`,
      world.pair.consumer.tenant,
    );
    await page.reload();

    // Record outcome as completed
    await page.getByRole("button", { name: "Record outcome" }).click();
    const outcomeModal = page.getByRole("dialog");
    await expect(outcomeModal).toBeVisible();
    await outcomeModal.getByRole("button", { name: "Record outcome" }).click();
    await expect(outcomeModal).toBeHidden();
    await expect(page.getByText("Outcome recorded.")).toBeVisible();
    await expect(page.getByText("completed", { exact: true })).toBeVisible();

    // Submit feedback
    await page.getByRole("button", { name: "Submit feedback" }).click();
    const feedbackModal = page.getByRole("dialog");
    await expect(feedbackModal).toBeVisible();
    await feedbackModal
      .locator("textarea")
      .fill("Outstanding technical depth and systems knowledge.");
    await feedbackModal
      .getByRole("button", { name: "Submit feedback" })
      .click();
    await expect(page.getByText("Feedback submitted.")).toBeVisible();
    await expect(feedbackModal).toBeHidden();

    // Verify feedback is visible
    await expect(
      page.locator(".ant-tag", { hasText: "Strong yes" }),
    ).toBeVisible();
    await expect(
      page
        .locator(".ant-card")
        .getByText("Outstanding technical depth and systems knowledge."),
    ).toBeVisible();
  });
});

test("records a background check outcome on routed work once consent is given", async ({
  page,
  request,
}) => {
  await withWorld(request, async (world) => {
    const bgCheck = await activate(world.pair, "background_check");
    await asProvider(world.pair, bgCheck.id, bgCheck.version);
    await assign(world, bgCheck.id, world.check);
    const appDetail = await candidate(world, world.check, "Katherine Johnson");
    const routedApp = await routed(world, appDetail, bgCheck.id);

    // Request consent from consumer
    const requested =
      await world.pair.consumer.api.requestBackgroundCheckConsent(
        world.pair.consumer.owner,
        {
          opening_number: world.opening.opening_number,
          application_number: appDetail.application_number,
          version: routedApp.version,
          check_types: ["identity", "education"],
        } as never,
      );
    expect(requested.status()).toBe(200);

    await signIn(page, world.pair.provider.org, world.pair.provider.tenant);

    // Open Work queue page
    await page.goto(`${ORGS_PORTAL}/work`);
    await expect(page.getByText("Katherine Johnson")).toBeVisible();
    await page.getByRole("button", { name: "View" }).click();

    // Initially consent is requested: verify awaiting candidate consent notice
    await expect(
      page.getByText("Awaiting candidate consent", { exact: false }),
    ).toBeVisible();

    // Candidate gives consent in consumer DB
    orgSQL(
      `UPDATE vetchium.org_background_checks SET consent_state = 'given', responded_at = now()
       WHERE performer_engagement_id = '${bgCheck.id}'`,
      world.pair.consumer.tenant,
    );

    // Reload work item page to see live update from consumer
    await page.reload();
    await expect(page.getByText("Consent given")).toBeVisible();

    // Record outcome on Identity verification check
    const identityCard = page.locator(".ant-card-small", {
      hasText: "Identity",
    });
    await identityCard.getByRole("button", { name: "Record result" }).click();

    // Fill notes in the inline form and submit
    await identityCard
      .locator("textarea")
      .fill("Passport verified successfully.");
    await identityCard.getByRole("button", { name: "Record outcome" }).click();

    // Outcome is recorded
    await expect(
      identityCard.getByText("Clear", { exact: true }),
    ).toBeVisible();
    await expect(
      identityCard.getByText("Passport verified successfully."),
    ).toBeVisible();
  });
});
