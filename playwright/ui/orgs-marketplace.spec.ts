import { readFile } from "node:fs/promises";
import { expect, test } from "../lib/admin-fixtures.ts";
import { addOrgMember } from "../lib/orgs-api.ts";
import {
  activate,
  listing,
  published,
  withPair,
  withProvider,
} from "../lib/orgs-marketplace.ts";
import { assign, candidate, withWorld } from "../lib/orgs-routing.ts";
import {
  chooseWorkspace,
  openAccountPage,
  sidebarPage,
  signIn,
  signOut,
} from "../lib/orgs-ui.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";
import { chooseOption } from "../lib/region-ui.ts";

test.describe.configure({ timeout: 180_000 });

test("finds a provider, inspects listing, and proposes an engagement", async ({
  page,
  request,
}) => {
  await withPair(
    request,
    { capabilities: ["interviewing"] },
    async ({ consumer, provider }) => {
      await signIn(page, consumer.org);

      await page.goto(`${ORGS_PORTAL}/providers`);
      await expect(
        page.getByRole("heading", { name: "Find providers" }),
      ).toBeVisible();

      // Switch to Interviewing capability
      await page.getByText("Interviewing", { exact: true }).click();

      // Provider's listing card is visible
      await expect(page.getByText(provider.org.domain)).toBeVisible();

      // Click card to open listing detail
      await page.getByText(provider.org.domain).click();
      await expect(page).toHaveURL(
        new RegExp(`/providers/listings/${provider.org.domain}/interviewing`),
      );
      await expect(
        page.getByRole("button", { name: "Propose engagement" }),
      ).toBeVisible();

      // Fill proposal form
      await page
        .getByPlaceholder("Describe the hiring or candidate needs...")
        .fill("We would like to partner with your team on interviewing.");
      await page.getByPlaceholder("PO-2026-…").fill("PO-INT-2026");
      await page.getByRole("button", { name: "Propose engagement" }).click();

      // Redirects to engagement detail in proposed state
      await expect(page).toHaveURL(/\/providers\/engagements\/[0-9a-f-]{36}/);
      await expect(
        page.locator(".ant-tag", { hasText: "Proposed" }),
      ).toBeVisible();
      await expect(page.getByText("PO-INT-2026")).toBeVisible();
    },
  );
});

test("manages an engagement: updates reference, exports statement CSV, and ends engagement", async ({
  page,
  request,
}) => {
  await withPair(request, { capabilities: ["interviewing"] }, async (pair) => {
    const engagement = await activate(pair, "interviewing");
    await signIn(page, pair.consumer.org);

    await page.goto(`${ORGS_PORTAL}/providers`);
    await page.getByRole("tab", { name: "Your engagements" }).click();
    await expect(page.getByText(pair.provider.org.domain)).toBeVisible();

    // Navigate to engagement detail
    await page.goto(`${ORGS_PORTAL}/providers/engagements/${engagement.id}`);
    await expect(page.getByText("Active", { exact: true })).toBeVisible();

    // Edit reference
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByPlaceholder("PO-2026-…").fill("CLIENT-REF-42");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("CLIENT-REF-42")).toBeVisible();

    // Export statement CSV
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const file = await (await download).path();
    const content = await readFile(file, "utf8");
    expect(content).toContain("Date,Fact,Opening");

    // End engagement with note
    await page
      .getByRole("button", { name: "End engagement", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await modal.getByRole("textbox").fill("Work completed successfully.");
    await modal
      .getByRole("button", { name: "End engagement", exact: true })
      .click();
    await expect(page.locator(".ant-tag", { hasText: "Ended" })).toBeVisible();
  });
});

test("assigns and unassigns opening providers and updates pipeline notes", async ({
  page,
  request,
}) => {
  await withWorld(request, async (world) => {
    await activate(world.pair, "sourcing");
    await activate(world.pair, "interviewing");

    await signIn(page, world.pair.consumer.org);
    const openingNumber = world.opening.opening_number;

    await page.goto(`${ORGS_PORTAL}/openings/${openingNumber}?tab=providers`);
    await expect(page.getByText("Sourcing agencies")).toBeVisible();

    // Assign sourcing agency
    await page.getByRole("button", { name: "Assign agency" }).click();
    const agencyDialog = page.getByRole("dialog");
    await expect(agencyDialog).toBeVisible();
    await agencyDialog
      .getByRole("radio", {
        name: new RegExp(world.pair.provider.org.domain),
      })
      .check();
    await agencyDialog.getByRole("button", { name: "Assign" }).click();
    await expect(agencyDialog).toBeHidden();
    await expect(
      page.getByText(world.pair.provider.org.domain, { exact: true }),
    ).toBeVisible();

    // Assign stage provider to Panel stage
    const panelCard = page.locator(".ant-card-small", { hasText: "Panel" });
    await panelCard.getByRole("button", { name: "Assign provider" }).click();
    const stageDialog = page.getByRole("dialog");
    await expect(stageDialog).toBeVisible();
    await stageDialog
      .getByRole("radio", {
        name: new RegExp(world.pair.provider.org.domain),
      })
      .check();
    await stageDialog.getByRole("button", { name: "Assign" }).click();
    await expect(stageDialog).toBeHidden();
    await expect(
      panelCard.getByText(world.pair.provider.org.domain),
    ).toBeVisible();

    // Pipeline tab reflects provider assignment
    await page.getByRole("tab", { name: "Pipeline" }).click();
    await expect(page.getByText("1 provider assigned")).toBeVisible();

    // Remove sourcing agency
    await page.getByRole("tab", { name: "Providers" }).click();
    await page
      .getByRole("button", { name: "Remove", exact: true })
      .first()
      .click();
    await expect(page.getByText("Agency removed from Opening.")).toBeVisible();
    await expect(
      page.getByRole("table").getByText(world.pair.provider.org.domain),
    ).toBeHidden();
  });
});

test("routes an application to a stage provider and displays attribution", async ({
  page,
  request,
}) => {
  await withWorld(request, async (world) => {
    const sourcing = await activate(world.pair, "sourcing");
    const interview = await activate(world.pair, "interviewing");

    await assign(world, sourcing.id);
    await assign(world, interview.id, world.panel);

    // The applicant names the sourcing agency when applying.
    const appDetail = await candidate(
      world,
      world.panel,
      "Katherine Johnson",
      world.pair.provider.org.domain,
    );

    await signIn(page, world.pair.consumer.org);
    const openingNumber = world.opening.opening_number;
    const appNumber = appDetail.application_number;

    await page.goto(
      `${ORGS_PORTAL}/openings/${openingNumber}/applications/${appNumber}`,
    );

    // Referral attribution card is shown on sidebar
    await expect(page.getByText("Referred by")).toBeVisible();
    await expect(page.getByText(world.pair.provider.org.domain)).toBeVisible();
    await expect(page.getByText("Declared", { exact: true })).toBeVisible();

    // Route picker updates who performs current stage
    const routePicker = page
      .locator(".ant-card", { hasText: "current stage" })
      .getByRole("combobox");
    await chooseOption(page, routePicker, interview.counterparty.display_name);
    await expect(page.getByText("Stage provider updated.")).toBeVisible();
    await expect(
      page.getByText("schedules these interviews and records feedback"),
    ).toBeVisible();

    // Candidates tab shows Performed by column
    await page.goto(`${ORGS_PORTAL}/openings/${openingNumber}?tab=candidates`);
    await expect(
      page.getByRole("columnheader", { name: "Performed by" }),
    ).toBeVisible();
    await expect(page.getByText("Katherine Johnson")).toBeVisible();
  });
});

test("workspaces show the work the Org does and the user may do, and personal pages sit in the account menu", async ({
  page,
  request,
}) => {
  await withProvider(request, async (provider) => {
    const member = await addOrgMember(
      provider.api,
      provider.owner,
      provider.org.domain,
      `openings@${provider.org.domain}`,
      ["org:manage_openings"],
    );
    const switcher = page.getByRole("combobox", { name: "Workspace" });
    const workspaceOptions = page.locator(
      ".ant-select-dropdown:visible .ant-select-item-option",
    );

    // Before the Org is a provider: hiring and administration only, with
    // Listings there so the Org can create its first.
    await signIn(page, provider.org, provider.tenant);
    await expect(sidebarPage(page, "Openings")).toBeVisible();
    await switcher.click();
    await expect(workspaceOptions).toHaveText(["Hiring", "Administration"]);
    await page.keyboard.press("Escape");
    await chooseWorkspace(page, "Administration");
    await expect(page).toHaveURL(/\/members$/);
    await expect(sidebarPage(page, "Listings")).toBeVisible();

    // A listed sourcing Listing adds Agency; a stage Capability adds Services.
    await published(provider.api, provider.owner, listing("sourcing", "S"));
    await page.reload();
    await chooseWorkspace(page, "Agency");
    await expect(page).toHaveURL(/\/jobs$/);
    for (const name of [
      "Jobs",
      "Contacts",
      "Credited applications",
      "Clients",
    ]) {
      await expect(sidebarPage(page, name)).toBeVisible();
    }
    await expect(sidebarPage(page, "Work queue")).toHaveCount(0);
    await published(provider.api, provider.owner, listing("interviewing", "I"));
    await page.reload();
    // The workspace chosen last stays across pages and reloads.
    await expect(sidebarPage(page, "Jobs")).toBeVisible();
    await chooseWorkspace(page, "Services");
    await expect(page).toHaveURL(/\/work$/);
    await expect(sidebarPage(page, "Work queue")).toBeVisible();
    // A page in two workspaces keeps the one chosen.
    await sidebarPage(page, "Clients").click();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(sidebarPage(page, "Work queue")).toBeVisible();

    // The account menu holds the person's own pages.
    await openAccountPage(page, "My interviews");
    await expect(page).toHaveURL(/\/my-interviews$/);
    await expect(sidebarPage(page, "Work queue")).toBeVisible();
    await openAccountPage(page, "My work");
    await expect(
      page.getByRole("heading", { name: "My work", level: 1 }),
    ).toBeVisible();

    // Each page still needs its permission: one workspace, no switcher.
    await signOut(page);
    await signIn(page, member, provider.tenant);
    await expect(sidebarPage(page, "Openings")).toBeVisible();
    await expect(switcher).toHaveCount(0);
    for (const name of ["Listings", "Jobs", "Contacts", "Work queue"]) {
      await expect(sidebarPage(page, name)).toHaveCount(0);
    }
  });
});
