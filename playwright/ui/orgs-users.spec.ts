import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  invitationToken,
  inviteeAddress,
  loginOrg,
  OrgsAPI,
  orgPassword,
  orgSQL,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";
import {
  chooseOption,
  chooseRegion,
  cleanupBrowserIdempotency,
} from "../lib/region-ui.ts";

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
}

async function openMembers(page: Page, user: Parameters<typeof signIn>[1]) {
  await signIn(page, user);
  await expect(page.getByTestId("shell-user-email")).toHaveText(
    user.emailAddress,
  );
  await page.goto(`${ORGS_PORTAL}/members`);
  await expect(
    page.getByRole("heading", { name: "Members", level: 1 }),
  ).toBeVisible();
}

function memberRow(page: Page, emailAddress: string) {
  return page.getByRole("row").filter({ hasText: emailAddress });
}

function ageSessions(emailAddress: string): void {
  orgSQL(
    `UPDATE vetchium.org_sessions
     SET created_at = now() - interval '10 minutes',
         authenticated_at = now() - interval '10 minutes'
     WHERE org_user_id IN (
       SELECT org_user_id FROM vetchium.org_users
       WHERE email_address = '${emailAddress}'
     )`,
  );
}

async function withOrg(
  request: Parameters<typeof signupOrg>[0]["request"],
  body: (org: SignedUpOrg, api: OrgsAPI, owner: string) => Promise<void>,
) {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    await body(org, api, owner);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
}

test("invites people in bulk, reports each address, and the invitee joins", async ({
  browser,
  page,
  request,
}) => {
  const keys: string[] = [];
  await withOrg(request, async (org) => {
    const fresh = inviteeAddress(org.domain, "new");
    const otherDomain = `someone@other-${org.domain}`;
    await openMembers(page, org);
    await page.getByRole("button", { name: "Invite people" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite people" });
    await dialog
      .getByLabel("Email addresses")
      .fill(`${fresh}, ${org.emailAddress}\n${otherDomain} not-an-address`);
    await expect(dialog.getByTestId("invite-address-count")).toHaveText(
      "4 addresses",
    );
    await dialog.getByRole("radio", { name: "User manager" }).check();
    await dialog.getByRole("button", { name: "Send invitations" }).click();
    await expect(dialog.getByTestId("invite-outcome")).toHaveText([
      "Invited",
      "Already a member",
      "Not at your domain",
      "Not an email address",
    ]);
    await dialog.getByRole("button", { name: "Done" }).click();

    await page.getByRole("tab", { name: "Invitations" }).click();
    const pending = memberRow(page, fresh);
    await expect(pending).toBeVisible();
    await expect(pending).toContainText("User manager");

    const invitee = await browser.newContext();
    try {
      const guest = await invitee.newPage();
      guest.on("request", (sent) => {
        if (sent.url().endsWith("/accept-invitation")) {
          keys.push(sent.headers()["idempotency-key"] ?? "");
        }
      });
      const token = await invitationToken(request, fresh);
      await guest.goto(
        `${ORGS_PORTAL}/accept-invitation?region=sgp&token=${token}`,
      );
      await expect(guest.getByTestId("invitation-domain")).toHaveText(
        org.domain,
      );
      await expect(guest.getByTestId("invitation-email")).toHaveText(fresh);
      const password = orgPassword();
      await guest.getByLabel("New password").fill(password);
      await guest.getByLabel("Confirm password").fill(password);
      await guest.getByRole("button", { name: "Create account" }).click();
      await expect(guest.getByTestId("accept-invitation-done")).toBeVisible();
      await guest.getByRole("link", { name: "Continue to sign in" }).click();
      await openMembers(guest, {
        domain: org.domain,
        emailAddress: fresh,
        password,
      });
      await expect(guest.getByTestId("user-seats")).toContainText(
        "2 of 5 seats used",
      );
    } finally {
      await invitee.close();
    }
    cleanupBrowserIdempotency("sgp", "orgs:accept-invitation", keys);
  });
});

test("an invitation link that cannot be used says so", async ({ page }) => {
  await page.goto(
    `${ORGS_PORTAL}/accept-invitation?region=sgp&token=${"a".repeat(64)}`,
  );
  await expect(
    page.getByText("This invitation is invalid, has expired", { exact: false }),
  ).toBeVisible();
  await page.goto(`${ORGS_PORTAL}/accept-invitation?token=${"a".repeat(64)}`);
  await expect(
    page.getByText("This invitation link is incomplete"),
  ).toBeVisible();
});

test("changes roles from the row, the custom drawer, and in bulk after step-up", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const first = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain, "one"),
      [],
    );
    const second = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain, "two"),
      [],
    );
    await openMembers(page, org);

    // The row dropdown applies a preset.
    const firstRole = page.getByRole("combobox", {
      name: `Role of ${first.emailAddress}`,
    });
    await chooseOption(page, firstRole, "Finance");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Change role" })
      .click();
    await expect(
      memberRow(page, first.emailAddress).getByTitle("Finance"),
    ).toBeVisible();

    // Custom opens the catalog checkboxes, which stay authoritative.
    const secondRole = page.getByRole("combobox", {
      name: `Role of ${second.emailAddress}`,
    });
    await chooseOption(page, secondRole, "Custom…");
    const drawer = page.getByRole("dialog", { name: "Custom permissions" });
    await drawer.getByRole("switch", { name: "MANAGE_USERS" }).click();
    await drawer.getByRole("switch", { name: "MANAGE_BILLING" }).click();
    await drawer.getByRole("button", { name: "Save" }).click();
    await expect(
      memberRow(page, second.emailAddress).getByTitle("Custom"),
    ).toBeVisible();

    // A bulk change needs a recent sign-in; confirming the password returns
    // here and the change then goes through.
    ageSessions(org.emailAddress);
    await page.reload();
    for (const user of [first, second]) {
      await memberRow(page, user.emailAddress).getByRole("checkbox").check();
    }
    await expect(page.getByTestId("bulk-bar")).toContainText("2 selected");
    await chooseOption(
      page,
      page.getByRole("combobox", { name: "Set role" }),
      "Member",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Change role" })
      .click();
    await page.getByRole("button", { name: "Confirm password" }).click();
    await expect(page).toHaveURL(/\/reauthenticate/);
    await page.getByLabel("Password").fill(org.password);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(`${ORGS_PORTAL}/members`);
    for (const user of [first, second]) {
      await memberRow(page, user.emailAddress).getByRole("checkbox").check();
    }
    await chooseOption(
      page,
      page.getByRole("combobox", { name: "Set role" }),
      "Member",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Change role" })
      .click();
    await expect(
      memberRow(page, first.emailAddress).getByTitle("Member"),
    ).toBeVisible();
    await expect(
      memberRow(page, second.emailAddress).getByTitle("Member"),
    ).toBeVisible();
  });
});

test("narrows the list by search, summary links, and state, and disables and enables", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const finance = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain, "fin"),
      ["org:manage_billing"],
    );
    const member = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain, "mem"),
      [],
    );
    await openMembers(page, org);
    await expect(memberRow(page, member.emailAddress)).toBeVisible();
    await expect(page.getByTestId("user-seats")).toContainText(
      "3 of 5 seats used",
    );

    await page.getByTestId("summary-role-finance").click();
    await expect(memberRow(page, finance.emailAddress)).toBeVisible();
    await expect(memberRow(page, member.emailAddress)).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(memberRow(page, member.emailAddress)).toBeVisible();

    await page
      .getByRole("textbox", { name: "Search by email address" })
      .first()
      .fill("mem-");
    await expect(memberRow(page, finance.emailAddress)).toHaveCount(0);
    await expect(memberRow(page, member.emailAddress)).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();

    await page
      .getByRole("button", { name: `Actions for ${member.emailAddress}` })
      .click();
    await page.getByRole("menuitem", { name: "Disable" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Disable" })
      .click();
    await expect(page.getByTestId("summary-state-disabled-manual")).toHaveText(
      "1 disabled",
    );
    await page.getByTestId("summary-state-disabled-manual").click();
    await expect(memberRow(page, member.emailAddress)).toContainText(
      "Disabled",
    );
    await expect(memberRow(page, finance.emailAddress)).toHaveCount(0);

    await page
      .getByRole("button", { name: `Actions for ${member.emailAddress}` })
      .click();
    await page.getByRole("menuitem", { name: "Enable" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Enable" })
      .click();
    await expect(page.getByTestId("summary-state-disabled-manual")).toHaveText(
      "0 disabled",
    );
  });
});

test("exports the member list as CSV", async ({ page, request }) => {
  await withOrg(request, async (org, api, owner) => {
    const finance = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain, "fin"),
      ["org:manage_billing"],
    );
    await openMembers(page, org);
    await expect(memberRow(page, finance.emailAddress)).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const file = await (await download).path();
    const lines = (await readFile(file, "utf8")).trim().split("\r\n");
    expect(lines[0]).toBe(
      "Email address,Role,Permissions,State,Joined,Last sign-in",
    );
    const rows = lines.slice(1).map((line) => line.split(","));
    expect(rows.map((row) => row.slice(0, 4))).toEqual(
      [
        [org.emailAddress, "Superadmin", "org:superadmin", "active"],
        [finance.emailAddress, "Finance", "org:manage_billing", "active"],
      ].sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? "")),
    );
  });
});

test("manages pending invitations: resend, cancel, and bulk cancel", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const addresses = [
      inviteeAddress(org.domain),
      inviteeAddress(org.domain),
      inviteeAddress(org.domain),
    ];
    await api.inviteUsers(owner, { email_addresses: addresses });
    await openMembers(page, org);
    await page.getByRole("tab", { name: "Invitations" }).click();
    for (const address of addresses) {
      await expect(memberRow(page, address)).toBeVisible();
    }

    await page
      .getByRole("button", { name: `Resend the invitation to ${addresses[0]}` })
      .click();
    await expect(
      page.getByText("The invitation was sent again."),
    ).toBeVisible();

    await page
      .getByRole("button", { name: `Cancel the invitation to ${addresses[0]}` })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel" })
      .last()
      .click();
    await expect(memberRow(page, addresses[0] ?? "")).toHaveCount(0);

    for (const address of addresses.slice(1)) {
      await memberRow(page, address).getByRole("checkbox").check();
    }
    await page.getByRole("button", { name: "Cancel selected" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel" })
      .last()
      .click();
    await expect(page.getByText("No pending invitations.")).toBeVisible();
  });
});

test("a user disabled for nonpayment is told why at sign-in", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const member = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain),
      [],
    );
    orgSQL(
      `UPDATE vetchium.org_users
       SET org_user_state = 'disabled', disabled_reason = 'nonpayment',
           disabled_at = now()
       WHERE email_address = '${member.emailAddress}'`,
    );
    await signIn(page, member);
    await expect(
      page.getByText("subscription was not paid", { exact: false }),
    ).toBeVisible();
    orgSQL(
      `UPDATE vetchium.org_users
       SET disabled_reason = 'manual'
       WHERE email_address = '${member.emailAddress}'`,
    );
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByText("This account is disabled", { exact: false }),
    ).toBeVisible();
  });
});
