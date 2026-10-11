import type { Page } from "@playwright/test";
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
import { chooseOption, chooseRegion } from "../lib/region-ui.ts";

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
    await page.getByRole("button", { name: "Save content" }).click();
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
    await chooseOption(
      page,
      page.getByRole("combobox", { name: "States" }),
      "Discarded",
    );
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
    await page.getByRole("button", { name: "Save team and notes" }).click();
    await expect(
      page.getByText(/not active members of this organization/).first(),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Hiring manager" })
      .fill(org.emailAddress);
    await page
      .getByRole("textbox", { name: "Internal notes" })
      .fill("Private note");
    await page.getByRole("button", { name: "Save team and notes" }).click();
    await expect(page).toHaveURL(/\/openings\/1$/);
    await expect(page.getByText("Private note")).toBeVisible();
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
