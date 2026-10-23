import type { Page } from "@playwright/test";
import type { TestTenant } from "./admin-db.ts";
import { expect } from "./admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "./dev-dns.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  type SignedUpOrg,
  signupOrg,
} from "./orgs-api.ts";
import { cleanupOutbox } from "./orgs-applications.ts";
import { ORGS_PORTAL } from "./portals.ts";
import { chooseRegion } from "./region-ui.ts";

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
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
}

/** Signs up an Org, runs `body` with its owner's token, then removes the Org
 * and the outbox events its applications queued. */
export async function withOrg(
  request: ConstructorParameters<typeof OrgsAPI>[0],
  body: (org: SignedUpOrg, api: OrgsAPI, owner: string) => Promise<void>,
) {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    await body(org, api, await loginOrg(api, org));
  } finally {
    cleanupOutbox(org.domain);
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
}
