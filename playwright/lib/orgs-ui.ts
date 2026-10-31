import type { Locator, Page } from "@playwright/test";
import type { TestTenant } from "./admin-db.ts";
import { expect } from "./admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "./dev-dns.ts";
import { cleanupApplicants, type HiringOrg } from "./hiring-seed.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgDID,
  type SignedUpOrg,
  signupOrg,
} from "./orgs-api.ts";
import { cleanupOutbox } from "./orgs-applications.ts";
import { ORGS_PORTAL } from "./portals.ts";
import { chooseOption, chooseRegion } from "./region-ui.ts";

export async function signIn(
  page: Page,
  user: Pick<SignedUpOrg, "domain" | "emailAddress" | "password">,
  region: TestTenant = "sgp",
) {
  await page.goto(`${ORGS_PORTAL}/login?domain=${user.domain}`);
  await page.getByLabel("Email address").fill(user.emailAddress);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await chooseRegion(page, region);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(accountMenu(page)).toBeVisible();
}

/** The header button opening the signed-in person's own pages and sign-out;
 * it shows only to a signed-in user. */
export function accountMenu(page: Page): Locator {
  return page.getByRole("button", { name: /^Account menu for / });
}

export async function signOut(page: Page): Promise<void> {
  await accountMenu(page).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
}

/** A menu item by its label; its accessible name also carries the icon's
 * name before the label and a badge's count after it. */
function menuItem(page: Page, name: string): Locator {
  return page.getByRole("menuitem", {
    name: new RegExp(`(^| )${name}( |$)`),
  });
}

/** Opens a page of the account menu, such as "My account". */
export async function openAccountPage(page: Page, name: string): Promise<void> {
  await accountMenu(page).click();
  await menuItem(page, name).click();
}

/** The sidebar link to a pinned page or a page of the workspace shown. */
export function sidebarPage(page: Page, name: string): Locator {
  return menuItem(page, name);
}

/** Shows a sidebar workspace (Hiring, a Capability such as Sourcing, or
 * Administration). The switcher appears only when the user has more than one. */
export async function chooseWorkspace(page: Page, name: string): Promise<void> {
  await chooseOption(
    page,
    page.getByRole("combobox", { name: "Workspace" }),
    name,
  );
}

/** Signs up an Org, runs `body` with its owner's token and a world to seed
 * applications in, then removes the Org, the applicants seeding created, and
 * the outbox events its applications queued. */
export async function withOrg(
  request: ConstructorParameters<typeof OrgsAPI>[0],
  body: (
    org: SignedUpOrg,
    api: OrgsAPI,
    owner: string,
    world: HiringOrg,
  ) => Promise<void>,
) {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  const world: HiringOrg = {
    request,
    tenant: "sgp",
    api,
    owner: "",
    domain: org.domain,
    did: orgDID(org.domain),
    applicants: [],
  };
  try {
    world.owner = await loginOrg(api, org);
    await body(org, api, world.owner, world);
  } finally {
    cleanupApplicants(world);
    cleanupOutbox(org.domain);
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
}
