import type { Page } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgSQL,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";
import { chooseRegion } from "../lib/region-ui.ts";

const completeContent: OpeningContent = {
  title: "Opening engineer",
  description: "Build reliable services",
  language: "en",
  employing_country: "SG",
  work_arrangement: "on_site",
  employment_type: "full_time",
  positions: 1,
};

async function createCompleteOpening(
  api: OrgsAPI,
  token: string,
  teamEmail: string,
) {
  const response = await api.createOpening(token, {
    content: completeContent,
    hiring_manager_email: teamEmail,
    recruiter_email: teamEmail,
    team_member_emails: [],
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as OrgOpening;
}

async function confirmOpeningAction(page: Page, name: string, note?: string) {
  await page.getByRole("button", { name, exact: true }).click();
  const dialog = page.getByRole("dialog");
  if (note !== undefined)
    await dialog.getByRole("textbox", { name: "Note" }).fill(note);
  await dialog
    .getByRole("button", { name: /^(Confirm|Submit for approval)$/ })
    .click();
}

test.describe.configure({ timeout: 90_000 });

async function signIn(
  page: Page,
  user: Pick<SignedUpOrg, "domain" | "emailAddress" | "password">,
) {
  await page.goto(`${ORGS_PORTAL}/login?domain=${user.domain}`);
  await page.getByLabel("Email address").fill(user.emailAddress);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await chooseRegion(page, "sgp");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("shell-org-name")).toBeVisible();
}

async function withOrg(
  request: ConstructorParameters<typeof OrgsAPI>[0],
  body: (org: SignedUpOrg, api: OrgsAPI, owner: string) => Promise<void>,
) {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    await body(org, api, await loginOrg(api, org));
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
}

test("creates a partial draft, previews Markdown, edits, duplicates, and discards", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/new`);
    await page.getByRole("textbox", { name: "Title" }).fill("Draft engineer");
    await page
      .getByRole("textbox", { name: "Description" })
      .fill("**Important** <script>bad</script>");
    await page
      .getByRole("textbox", { name: "Location details" })
      .fill("<script>plain</script>");
    await page.getByRole("tab", { name: "Candidate preview" }).click();
    await expect(page.getByText("Important", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Important <script>bad</script>"),
    ).toBeVisible();
    await expect(
      page.getByRole("article").getByText("<script>plain</script>"),
    ).toBeVisible();
    await expect(page.locator("script", { hasText: "plain" })).toHaveCount(0);
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/openings\/1$/);
    await expect(page.getByText("Draft engineer").first()).toBeVisible();
    const read = await api.getOpening(owner, { opening_number: 1 });
    expect(read.status()).toBe(200);
    expect((await read.json()) as OrgOpening).toMatchObject({
      state: "draft",
      working_content: { title: "Draft engineer" },
    });

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Title" }).fill("Edited engineer");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/\/openings\/1$/);
    await expect(
      page.getByRole("heading", { name: /Edited engineer/, level: 1 }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Duplicate" }).click();
    await expect(page).toHaveURL(/\/openings\/2$/);
    await expect(
      page.getByRole("heading", { name: /Edited engineer/, level: 1 }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Discard draft" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Discard draft" })
      .click();
    await expect(page.getByText("Discarded", { exact: true })).toBeVisible();
  });
});

test("list filters and keyset pagination show only requested states", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    for (let index = 0; index < 25; index++) {
      const response = await api.createOpening(owner, {
        content: { title: `Opening ${index}` },
        team_member_emails: [],
      });
      expect(response.status()).toBe(201);
    }
    orgSQL(`INSERT INTO vetchium.org_openings (org_opening_id, org_did, opening_number, created_by)
      SELECT gen_random_uuid(), o.org_did, 26, u.org_user_id FROM vetchium.orgs AS o
      JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
      JOIN vetchium.org_users AS u ON u.org_did = o.org_did
      WHERE d.domain = '${org.domain}' AND u.email_address = '${org.emailAddress}'`);
    orgSQL(
      `UPDATE vetchium.orgs SET next_opening_number = 27 WHERE org_did = (SELECT org_did FROM vetchium.org_domains WHERE domain = '${org.domain}')`,
    );
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings`);
    await expect(page.getByRole("table")).toBeVisible();
    await expect(
      page.getByText("Openings created in the last 365 days: 26 of 25"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(
      page.getByRole("row").filter({ hasText: "Opening 0" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Previous" }).click();
    await page
      .getByRole("searchbox", { name: "Search title" })
      .fill("Opening 17");
    await page.getByRole("searchbox", { name: "Search title" }).press("Enter");
    await expect(
      page.getByRole("row").filter({ hasText: "Opening 17" }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "Opening 16" }),
    ).toHaveCount(0);
    const discarded = await api.discardOpening(owner, {
      opening_number: 18,
      version: 1,
    });
    expect(discarded.status()).toBe(200);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: "#18" })).toHaveCount(
      0,
    );
    await page.getByRole("tab", { name: "Discarded (1)" }).click();
    await expect(
      page.getByRole("row").filter({ hasText: "#18" }),
    ).toBeVisible();
  });
});

test("hiring-team readers see only their Opening; other members see an empty list", async ({
  browser,
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
    const other = await addOrgMember(
      api,
      owner,
      org.domain,
      `other@${org.domain}`,
      [],
    );
    const created = await api.createOpening(owner, {
      content: { title: "Team only" },
      hiring_manager_email: reader.emailAddress,
      team_member_emails: [],
    });
    expect(created.status()).toBe(201);
    await signIn(page, reader);
    await page.goto(`${ORGS_PORTAL}/openings`);
    await expect(page.getByText("Team only")).toBeVisible();
    await expect(
      page.getByText("Openings created in the last 365 days: 1 of 25"),
    ).toBeVisible();
    await page.goto(`${ORGS_PORTAL}/openings/1`);
    await expect(
      page.getByRole("heading", { name: /Team only/, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    const context = await browser.newContext();
    try {
      const guest = await context.newPage();
      await signIn(guest, other);
      await guest.goto(`${ORGS_PORTAL}/openings`);
      await expect(
        guest.getByText("No Openings are available to you for these filters."),
      ).toBeVisible();
      await expect(
        guest.getByText("This information could not be loaded."),
      ).toHaveCount(0);
      await guest.goto(`${ORGS_PORTAL}/openings/1`);
      await expect(
        guest.getByText("Opening not found or unavailable."),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

test("Opening managers can find an active team member by exact email", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    await signIn(page, manager);
    await page.goto(`${ORGS_PORTAL}/openings/new`);
    await page
      .getByRole("combobox", { name: "Hiring manager" })
      .fill(org.emailAddress);
    await expect(
      page
        .locator(".ant-select-dropdown:visible .ant-select-item-option-content")
        .filter({ hasText: org.emailAddress }),
    ).toBeVisible();
  });
});

test("invalid team addresses and a full quota get specific messages", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org) => {
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/new`);
    await page
      .getByRole("combobox", { name: "Hiring manager" })
      .fill(`unknown@${org.domain}`);
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(
      page.getByText(/not active members of this organization/).first(),
    ).toBeVisible();
    orgSQL(`INSERT INTO vetchium.org_openings (org_opening_id, org_did, opening_number, created_by)
      SELECT gen_random_uuid(), o.org_did, n, u.org_user_id FROM vetchium.orgs AS o
      JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
      JOIN vetchium.org_users AS u ON u.org_did = o.org_did
      CROSS JOIN generate_series(1, 25) AS n WHERE d.domain = '${org.domain}' AND u.email_address = '${org.emailAddress}'`);
    orgSQL(
      `UPDATE vetchium.orgs SET next_opening_number = 26 WHERE org_did = (SELECT org_did FROM vetchium.org_domains WHERE domain = '${org.domain}')`,
    );
    await page.getByRole("combobox", { name: "Hiring manager" }).fill("");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByText(/quota is full/)).toBeVisible();
  });
});

test("team edits flag invalid addresses and save valid members", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const created = await api.createOpening(owner, {
      content: { title: "Team editor" },
      hiring_manager_email: org.emailAddress,
      recruiter_email: org.emailAddress,
      team_member_emails: [],
    });
    expect(created.status()).toBe(201);
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/1/edit`);
    await page
      .getByRole("combobox", { name: "Hiring manager" })
      .fill(`unknown@${org.domain}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText(/not active members of this organization/).first(),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Hiring manager" })
      .fill(org.emailAddress);
    await page
      .getByRole("textbox", { name: "Internal notes" })
      .fill("Private note");
    // One save keeps both sections' edits.
    await page.getByRole("textbox", { name: "Title" }).fill("Team editor v2");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/\/openings\/1$/);
    await expect(page.getByText("Private note")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Team editor v2/, level: 1 }),
    ).toBeVisible();
  });
});

test("a new Opening starts from the Org's country and default language", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const details = await api.setCompanyDetails(owner, {
      display_name: "Playwright Org",
      country: "DE",
      default_language: "de-DE",
    });
    expect(details.status(), await details.text()).toBe(204);
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings`);
    await expect(
      page.getByRole("heading", { name: "Openings", level: 1 }),
    ).toBeVisible();
    await expect(page.getByTestId("shell-org-name")).toHaveCount(0);

    await page.getByRole("button", { name: "New Opening" }).click();
    await expect(page.getByText("Germany", { exact: true })).toBeVisible();
    await expect(page.getByText("German", { exact: true })).toBeVisible();
    await expect(page.getByTestId("shell-org-name")).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "Title" })
      .fill("Prefilled engineer");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/openings\/1$/);
    const read = await api.getOpening(owner, { opening_number: 1 });
    expect(read.status()).toBe(200);
    expect((await read.json()) as OrgOpening).toMatchObject({
      working_content: {
        title: "Prefilled engineer",
        language: "de",
        employing_country: "DE",
      },
    });
  });
});

test("an incomplete draft names the fields that block publication", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const created = await api.createOpening(owner, {
      content: { title: "Incomplete engineer" },
      hiring_manager_email: org.emailAddress,
      team_member_emails: [],
    });
    expect(created.status(), await created.text()).toBe(201);
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/1`);
    const gaps = page
      .getByRole("alert")
      .filter({ hasText: "Complete these fields before publishing" });
    await expect(gaps).toBeVisible();
    for (const label of [
      "Description",
      "Work arrangement",
      "Employment type",
      "Positions",
      "Recruiter",
    ]) {
      await expect(
        gaps.getByRole("listitem").filter({ hasText: label }),
      ).toBeVisible();
    }
    // The Org's country fills a new Opening's employing country.
    for (const label of ["Title", "Employing country"]) {
      await expect(
        gaps.getByRole("listitem").filter({ hasText: label }),
      ).toHaveCount(0);
    }
    await expect(
      gaps.getByRole("listitem").filter({ hasText: "Hiring manager" }),
    ).toHaveCount(0);

    // The page's hint does not stop the request; the API's refusal names the
    // same fields.
    await confirmOpeningAction(page, "Publish");
    const refusal = page
      .getByRole("dialog")
      .getByRole("alert")
      .filter({ hasText: "This Opening is incomplete" });
    await expect(refusal).toBeVisible();
    await expect(
      refusal.getByRole("listitem").filter({ hasText: "Work arrangement" }),
    ).toBeVisible();
    await expect(
      refusal.getByRole("listitem").filter({ hasText: "Recruiter" }),
    ).toBeVisible();
    const unchanged = await api.getOpening(owner, { opening_number: 1 });
    const current = (await unchanged.json()) as OrgOpening;
    expect(current.state).toBe("draft");

    const saved = await api.saveOpeningWorkingCopy(owner, {
      opening_number: 1,
      version: current.version,
      content: completeContent,
    });
    expect(saved.status(), await saved.text()).toBe(200);
    const team = await api.setOpeningTeam(owner, {
      opening_number: 1,
      version: ((await saved.json()) as OrgOpening).version,
      hiring_manager_email: org.emailAddress,
      recruiter_email: org.emailAddress,
      team_member_emails: [],
    });
    expect(team.status(), await team.text()).toBe(200);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Publish", exact: true }),
    ).toBeVisible();
    await expect(gaps).toHaveCount(0);
  });
});

test.describe("in a British browser in India", () => {
  test.use({ locale: "en-GB", timezoneId: "Asia/Kolkata" });

  test("Opening times follow the browser's conventions and name its time zone", async ({
    page,
    request,
  }) => {
    await withOrg(request, async (org, api, owner) => {
      const created = await api.createOpening(owner, {
        content: { title: "Timed engineer" },
        team_member_emails: [],
      });
      expect(created.status(), await created.text()).toBe(201);
      await signIn(page, org);
      await page.goto(`${ORGS_PORTAL}/openings`);
      const moment = /\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} GMT\+5:30/;
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "Timed engineer" })
          .getByRole("cell", { name: moment }),
      ).toBeVisible();
      await page.goto(`${ORGS_PORTAL}/openings/1`);
      await expect(
        page.getByRole("listitem").filter({ hasText: moment }),
      ).toBeVisible();
    });
  });
});

test("a suspended organization cannot open Opening pages", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org) => {
    await signIn(page, org);
    orgSQL(`UPDATE vetchium.orgs SET org_state='suspended', suspended_at=now()
      WHERE org_did=(SELECT org_did FROM vetchium.org_domains WHERE domain='${org.domain}')`);
    await page.goto(`${ORGS_PORTAL}/openings`);
    await expect(page).toHaveURL(`${ORGS_PORTAL}/restore-domain`);
  });
});

test("list exposes loading and retry states and remains usable by keyboard", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org) => {
    await signIn(page, org);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/orgs/list-openings", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(`${ORGS_PORTAL}/openings`);
    await expect(page.locator(".ant-spin-spinning")).toBeVisible();
    release?.();
    await expect(page.getByRole("table")).toBeVisible();
    await page.unroute("**/api/orgs/list-openings");
    await page.route("**/api/orgs/list-openings", async (route) => {
      await route.abort("failed");
    });
    await page.reload();
    await expect(
      page.getByText("This information could not be loaded."),
    ).toBeVisible();
    await page.unroute("**/api/orgs/list-openings");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("table")).toBeVisible();
    await page
      .getByRole("searchbox", { name: "Search title" })
      .fill("Engineer");
    await page.getByRole("searchbox", { name: "Search title" }).press("Enter");
    await expect(page.getByRole("table")).toBeVisible();
  });
});

test("manager submits publication and approver finds and approves it", async ({
  browser,
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    await createCompleteOpening(api, manager.token, manager.emailAddress);
    const managerPage = await browser.newPage();
    let releaseRequest = () => {};
    try {
      await signIn(managerPage, manager);
      await managerPage.goto(`${ORGS_PORTAL}/openings/1`);
      let markRequestStarted = () => {};
      const requestStarted = new Promise<void>((resolve) => {
        markRequestStarted = resolve;
      });
      const requestGate = new Promise<void>((release) => {
        releaseRequest = release;
      });
      await managerPage.route(
        "**/api/orgs/request-opening-change",
        async (route) => {
          markRequestStarted();
          await requestGate;
          await route.continue();
        },
      );
      await confirmOpeningAction(
        managerPage,
        "Submit for approval: Publish",
        "Ready for review",
      );
      await requestStarted;
      const actionDialog = managerPage.getByRole("dialog");
      await expect(
        actionDialog.getByRole("button", { name: "Cancel" }),
      ).toBeDisabled();
      await expect(
        actionDialog.getByRole("textbox", { name: "Note" }),
      ).toBeDisabled();
      releaseRequest();
      await expect(managerPage.getByText("Ready for review")).toBeVisible();
      await signIn(page, org);
      await page.goto(`${ORGS_PORTAL}/openings`);
      await expect(
        page
          .locator(".ant-statistic")
          .filter({ hasText: "Awaiting my approval" }),
      ).toContainText("1");
      await page.getByRole("button", { name: "Review requests" }).click();
      await expect(
        page.getByText(
          "Showing Openings with a request awaiting your approval.",
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("row").filter({ hasText: "Opening engineer" }),
      ).toBeVisible();
      await page.goto(`${ORGS_PORTAL}/openings/1`);
      await expect(page.getByText(manager.emailAddress).first()).toBeVisible();
      await confirmOpeningAction(page, "Approve");
      await expect(
        page.getByText("Published", { exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(
        0,
      );
    } finally {
      releaseRequest();
      await managerPage.close();
    }
  });
});

test("rejection requires a note, then manager withdraws and resubmits", async ({
  browser,
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    await createCompleteOpening(api, manager.token, manager.emailAddress);
    const managerPage = await browser.newPage();
    try {
      await signIn(managerPage, manager);
      await signIn(page, org);
      await managerPage.goto(`${ORGS_PORTAL}/openings/1`);
      await confirmOpeningAction(managerPage, "Submit for approval: Publish");
      await page.goto(`${ORGS_PORTAL}/openings/1`);
      await page.getByRole("button", { name: "Reject" }).click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("button", { name: "Confirm" }),
      ).toBeDisabled();
      await dialog
        .getByRole("textbox", { name: "Note" })
        .fill("Please add detail");
      await dialog.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText("Please add detail")).toBeVisible();
      await managerPage.reload();
      await confirmOpeningAction(managerPage, "Submit for approval: Publish");
      await expect(
        managerPage.getByRole("button", { name: "Withdraw request" }),
      ).toBeVisible();
      await managerPage
        .getByRole("button", { name: "Withdraw request" })
        .click();
      await expect(
        managerPage.getByRole("button", {
          name: "Submit for approval: Publish",
        }),
      ).toBeVisible();
      await confirmOpeningAction(managerPage, "Submit for approval: Publish");
      await expect(
        managerPage.getByRole("button", { name: "Withdraw request" }),
      ).toBeVisible();
    } finally {
      await managerPage.close();
    }
  });
});

test("approver directly publishes, revises, pauses, reopens, and closes over a pending request", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    await createCompleteOpening(api, owner, org.emailAddress);
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/1`);
    await confirmOpeningAction(page, "Publish");
    await expect(
      page.getByText("Published", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Title" }).fill("Revised engineer");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Revised engineer").first()).toBeVisible();
    await confirmOpeningAction(page, "Publish revision");
    await expect(page.getByText("Revised engineer").first()).toBeVisible();
    await confirmOpeningAction(page, "Pause");
    await expect(
      page.getByText("Paused", { exact: true }).first(),
    ).toBeVisible();
    await confirmOpeningAction(page, "Reopen");
    await expect(
      page.getByText("Published", { exact: true }).first(),
    ).toBeVisible();
    const read = await api.getOpening(owner, { opening_number: 1 });
    const current = (await read.json()) as OrgOpening;
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const pending = await api.requestOpeningChange(manager.token, {
      opening_number: 1,
      version: current.version,
      kind: "pause",
    });
    expect(pending.status(), await pending.text()).toBe(200);
    await page.reload();
    await expect(page.getByText("Pending request").first()).toBeVisible();
    await confirmOpeningAction(page, "Close");
    await expect(
      page.getByText("Closed", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Superseded")).toBeVisible();
  });
});

test("revision review shows live and working copies and reports a version conflict", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const created = await createCompleteOpening(api, owner, org.emailAddress);
    const publishedResponse = await api.requestOpeningChange(owner, {
      opening_number: 1,
      version: created.version,
      kind: "publish",
    });
    const published = (await publishedResponse.json()) as OrgOpening;
    const savedResponse = await api.saveOpeningWorkingCopy(owner, {
      opening_number: 1,
      version: published.version,
      content: { ...published.live_content, title: "New revision" },
    });
    const saved = (await savedResponse.json()) as OrgOpening;
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const requested = await api.requestOpeningChange(manager.token, {
      opening_number: 1,
      version: saved.version,
      kind: "revise",
      note: "Review this change",
    });
    expect(requested.status(), await requested.text()).toBe(200);
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/1`);
    await expect(page.getByText("Live content", { exact: true })).toBeVisible();
    await expect(page.getByText("Working copy", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Review this change", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    const read = await api.getOpening(owner, { opening_number: 1 });
    const current = (await read.json()) as OrgOpening;
    const changed = await api.setOpeningTeam(owner, {
      opening_number: 1,
      version: current.version,
      team_member_emails: [],
      internal_notes: "New internal note",
    });
    expect(changed.status(), await changed.text()).toBe(200);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm" })
      .click();
    await expect(page.getByText(/This Opening changed/).first()).toBeVisible();
  });
});

test("manager requests pause, reopen, and close and approver confirms each effect", async ({
  browser,
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const created = await createCompleteOpening(api, owner, org.emailAddress);
    const published = await api.requestOpeningChange(owner, {
      opening_number: 1,
      version: created.version,
      kind: "publish",
    });
    expect(published.status(), await published.text()).toBe(200);
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const managerPage = await browser.newPage();
    try {
      await signIn(managerPage, manager);
      await signIn(page, org);
      for (const [kind, effect, state] of [
        ["pause", "Pause", "Paused"],
        ["reopen", "Reopen", "Published"],
        ["close", "Close", "Closed"],
      ] as const) {
        await managerPage.goto(`${ORGS_PORTAL}/openings/1`);
        await confirmOpeningAction(
          managerPage,
          `Submit for approval: ${effect}`,
        );
        await page.goto(`${ORGS_PORTAL}/openings/1`);
        await page.getByRole("button", { name: "Approve" }).click();
        if (kind === "pause" || kind === "close") {
          await expect(
            page.getByRole("dialog").getByRole("alert"),
          ).toBeVisible();
        }
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Confirm" })
          .click();
        await expect(
          page.getByText(state, { exact: true }).first(),
        ).toBeVisible();
      }
    } finally {
      await managerPage.close();
    }
  });
});
