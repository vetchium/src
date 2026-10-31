import type { ApplicationDetail } from "typespec/orgs/applications/applications";
import { expect, test } from "../lib/admin-fixtures.ts";
import { seedApplication } from "../lib/hiring-seed.ts";
import { inviteeAddress, orgSQL } from "../lib/orgs-api.ts";
import {
  detailOf,
  orgDIDSQL,
  publishedOpening,
  stageOf,
} from "../lib/orgs-applications.ts";
import {
  accountMenu,
  openAccountPage,
  sidebarPage,
  signIn,
  withOrg,
} from "../lib/orgs-ui.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";

test.describe.configure({ timeout: 180_000 });

test("Home shows the interviews waiting on the person and stays pinned in the sidebar", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening, stages } = await publishedOpening(api, owner, org, {
      title: "Platform engineer",
    });
    const n = opening.opening_number;
    const panel = stageOf(stages, 1);
    const schedule = async (name: string): Promise<number> => {
      const { number } = await seedApplication(world, n, {
        name,
        state: "in_pipeline",
        stageId: panel.id,
      });
      const before: ApplicationDetail = await detailOf(api, owner, n, number);
      const response = await api.scheduleInterview(owner, {
        opening_number: n,
        application_number: number,
        version: before.version,
        start_time: new Date(Date.now() + 2 * 3_600_000).toISOString(),
        duration_minutes: 45,
        mode: "video",
        video_url: "https://meet.example.com/room",
        interviewer_emails: [org.emailAddress],
      });
      expect(response.status(), await response.text()).toBe(200);
      return number;
    };
    await schedule("Ada Lovelace");
    const held = await schedule("Grace Hopper");
    // As if Grace's interview had been held and marked completed.
    orgSQL(
      `UPDATE vetchium.org_interviews AS i
       SET starts_at = now() - interval '2 hours',
           interview_state = 'completed', ended_at = now()
       FROM vetchium.org_applications AS a
       JOIN vetchium.org_openings AS o USING (org_opening_id)
       WHERE a.org_application_id = i.org_application_id
         AND o.org_did = ${orgDIDSQL(org.domain)}
         AND o.opening_number = ${n}
         AND a.application_number = ${held}`,
    );

    await signIn(page, org);
    await expect(page).toHaveURL(`${ORGS_PORTAL}/`);
    await expect(
      page.getByRole("heading", { name: "Home", level: 1 }),
    ).toBeVisible();
    await expect(page.getByTestId("home-upcoming-count")).toContainText("1");
    await expect(page.getByTestId("home-feedback-due-count")).toContainText(
      "1",
    );
    const upcoming = page.getByTestId("home-upcoming");
    await expect(
      upcoming.getByRole("link", { name: "Ada Lovelace" }),
    ).toBeVisible();
    await expect(upcoming.getByText("Grace Hopper")).toHaveCount(0);
    const due = page.getByTestId("home-feedback-due");
    await expect(due.getByRole("link", { name: "Grace Hopper" })).toBeVisible();
    await expect(due.getByText("Due", { exact: true })).toBeVisible();
    // The owner runs the Opening and approves its own requests at once.
    await expect(
      page
        .getByTestId("home-openings")
        .getByRole("link", { name: "Platform engineer" }),
    ).toBeVisible();
    await expect(page.getByTestId("home-approvals")).toContainText(
      "No Opening requests are waiting for you.",
    );
    // No account details, and no marketplace cards for an Org with none.
    await expect(page.getByText("Signed in as")).toHaveCount(0);
    await expect(page.getByTestId("home-jobs")).toHaveCount(0);
    await expect(page.getByTestId("home-work")).toHaveCount(0);
    await expect(page.getByTestId("home-client-requests")).toHaveCount(0);
    await expect(page.getByTestId("home-seats-alert")).toHaveCount(0);

    // Home and My interviews stay in the sidebar from any workspace page.
    await sidebarPage(page, "Openings").click();
    await expect(page).toHaveURL(`${ORGS_PORTAL}/openings`);
    await sidebarPage(page, "Home").click();
    await expect(page).toHaveURL(`${ORGS_PORTAL}/`);
    await sidebarPage(page, "Openings").click();
    await sidebarPage(page, "My interviews").click();
    await expect(page).toHaveURL(`${ORGS_PORTAL}/my-interviews`);
    await expect(sidebarPage(page, "Openings")).toBeVisible();
    // The account menu keeps only the account.
    await accountMenu(page).click();
    const dropdown = page
      .getByRole("menu")
      .filter({ has: page.getByRole("menuitem", { name: /Sign out/ }) });
    await expect(
      dropdown.getByRole("menuitem", { name: /My account/ }),
    ).toBeVisible();
    await expect(dropdown.getByRole("menuitem", { name: /Home/ })).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");
    await openAccountPage(page, "My account");
    await expect(page).toHaveURL(`${ORGS_PORTAL}/account`);
  });
});

test("My interviews opens on Upcoming and keeps its tab in the URL", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner, world) => {
    const { opening, stages } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const { number } = await seedApplication(world, n, {
      name: "Alan Turing",
      state: "in_pipeline",
      stageId: stageOf(stages, 1).id,
    });
    const scheduled = await api.scheduleInterview(owner, {
      opening_number: n,
      application_number: number,
      version: (await detailOf(api, owner, n, number)).version,
      start_time: new Date(Date.now() + 3_600_000).toISOString(),
      duration_minutes: 30,
      mode: "video",
      video_url: "https://meet.example.com/room",
      interviewer_emails: [org.emailAddress],
    });
    expect(scheduled.status(), await scheduled.text()).toBe(200);
    // Over but not recorded: the interviewer still owes the outcome.
    orgSQL(
      `UPDATE vetchium.org_interviews AS i
       SET starts_at = now() - interval '2 hours'
       FROM vetchium.org_applications AS a
       JOIN vetchium.org_openings AS o USING (org_opening_id)
       WHERE a.org_application_id = i.org_application_id
         AND o.org_did = ${orgDIDSQL(org.domain)}
         AND o.opening_number = ${n}
         AND a.application_number = ${number}`,
    );

    await signIn(page, org);
    await expect(
      page.getByTestId("home-feedback-due").getByText("Record the outcome"),
    ).toBeVisible();
    await page
      .getByTestId("home-feedback-due")
      .getByRole("link", { name: "See all" })
      .click();
    await expect(page).toHaveURL(
      `${ORGS_PORTAL}/my-interviews?tab=feedback_due`,
    );
    const feedbackTab = page.getByRole("tab", { name: "Feedback due (1)" });
    await expect(feedbackTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("link", { name: "Alan Turing" })).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Record the outcome" }),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Upcoming (0)" }).click();
    await expect(page).toHaveURL(`${ORGS_PORTAL}/my-interviews`);
    await expect(page.getByText("No interviews are coming up.")).toBeVisible();

    await page.getByRole("tab", { name: "All", exact: true }).click();
    await expect(page).toHaveURL(`${ORGS_PORTAL}/my-interviews?tab=all`);
    await page.reload();
    await expect(
      page.getByRole("tab", { name: "All", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("link", { name: "Alan Turing" })).toBeVisible();
  });
});

test("Home warns billing managers as seats run out", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    // Free holds 5 seats; the owner and three invitations use 80 percent.
    const invited = await api.inviteUsers(owner, {
      email_addresses: Array.from({ length: 3 }, () =>
        inviteeAddress(org.domain),
      ),
    });
    expect(invited.status(), await invited.text()).toBe(200);
    await signIn(page, org);
    const alert = page.getByTestId("home-seats-alert");
    await expect(alert).toContainText("4 of 5 seats are in use.");

    const last = await api.inviteUsers(owner, {
      email_addresses: [inviteeAddress(org.domain)],
    });
    expect(last.status(), await last.text()).toBe(200);
    await page.reload();
    await expect(alert).toContainText("All 5 seats are in use");
    await alert.getByRole("link", { name: "Change plan" }).click();
    await expect(page).toHaveURL(`${ORGS_PORTAL}/plans`);
  });
});
