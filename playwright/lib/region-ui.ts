import { createHash, randomUUID } from "node:crypto";
import {
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import type { OrgDomain } from "typespec/orgs/types";
import {
  cleanupHubAliasClaim,
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  seedHubSignupDomain,
  sqlLiteral,
  sqlScalarForTenant,
  type TestTenant,
} from "./admin-db.ts";
import { deleteOrgVerificationRecord, uniqueOrgDomain } from "./dev-dns.ts";
import { signup } from "./hub-signup.ts";
import {
  cleanupOrg,
  OrgsAPI,
  type SignedUpOrg,
  signupOrg,
} from "./orgs-api.ts";

/** How the portals' English region picker names each CI region. */
export const REGION_LABELS = {
  deu: "Germany (deu)",
  ind1: "India (ind1)",
  sgp: "Singapore (sgp)",
  usa1: "United States (usa1)",
} as const satisfies Record<TestTenant, string>;

export function regionPicker(page: Page) {
  return page.getByRole("combobox", { name: "Region" });
}

/** Opens an antd Select and picks the visible option titled `title`. */
export async function chooseOption(
  page: Page,
  combobox: Locator,
  title: string,
): Promise<void> {
  await combobox.click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByTitle(title, { exact: true })
    .click();
}

export function chooseRegion(page: Page, tenant: TestTenant): Promise<void> {
  return chooseOption(page, regionPicker(page), REGION_LABELS[tenant]);
}

/** antd renders the selected option as the title of the combobox's
 * container rather than as the input's value. */
export async function expectSelectedRegion(
  page: Page,
  tenant: TestTenant,
): Promise<void> {
  await expect(regionPicker(page).locator("..")).toHaveAttribute(
    "title",
    REGION_LABELS[tenant],
  );
}

/** Collects the host of every request the page sends to a regional API. */
export function recordRegionalAPIHosts(page: Page): string[] {
  const hosts: string[] = [];
  page.on("request", (request) => {
    const host = new URL(request.url()).host;
    if (host.endsWith(".api.vetchium.localhost")) hosts.push(host);
  });
  return hosts;
}

/**
 * Deletes the ledger row a browser-driven password reset left. The browser
 * chooses its own idempotency key, so the row is found by its binding: the
 * hash of the test-owned reset token.
 */
export function cleanupPasswordResetLedger(
  portal: "hub" | "orgs",
  tenant: TestTenant,
  resetToken: string,
): void {
  if (!/^[0-9a-f]{64}$/.test(resetToken)) {
    throw new Error("refusing ledger cleanup for a malformed reset token");
  }
  const binding = createHash("sha256").update(resetToken).digest("base64url");
  sqlScalarForTenant(
    tenant,
    `DELETE FROM vetchium.idempotency_ledger
     WHERE operation = ${sqlLiteral(`${portal}:complete-password-reset`)}
       AND binding_id = ${sqlLiteral(binding)};`,
  );
}

/**
 * Deletes ledger rows a browser request left under its own idempotency key,
 * which is not test-prefixed. Pass only keys read from this test's own
 * requests, scoped by operation, so no other test's rows can match.
 */
export function cleanupBrowserIdempotency(
  tenant: TestTenant,
  operation: string,
  keys: readonly string[],
): void {
  if (keys.length === 0) return;
  sqlScalarForTenant(
    tenant,
    `DELETE FROM vetchium.idempotency_ledger
     WHERE operation = ${sqlLiteral(operation)}
       AND idempotency_key IN (${keys.map(sqlLiteral).join(", ")});`,
  );
}

export interface HubTestUser {
  tenant: TestTenant;
  email: string;
  password: string;
  handle: string;
  displayName: string;
  /** Idempotency keys to delete with the user; tests add browser keys. */
  keys: string[];
}

export interface OrgTestOrg extends SignedUpOrg {
  tenant: TestTenant;
}

interface RegionFixtures {
  hubUser: (
    tenant: TestTenant,
    options?: { displayName?: string; residentCountry?: string },
  ) => Promise<HubTestUser>;
  org: (tenant: TestTenant) => Promise<OrgTestOrg>;
}

/**
 * Creates real Hub users and Orgs through each region's API and removes
 * everything they leave behind after the test, including rows left by a
 * setup that failed halfway.
 */
export const test = base.extend<RegionFixtures>({
  hubUser: async ({ request }, use) => {
    const created: {
      tenant: TestTenant;
      domain: string;
      email: string;
      keys: string[];
      did: string | undefined;
    }[] = [];
    await use(async (tenant, options = {}) => {
      const domain = `e2e-${randomUUID()}.example.test`;
      const record = {
        tenant,
        domain,
        email: `e2e+${randomUUID()}@${domain}`,
        keys: [] as string[],
        did: undefined as string | undefined,
      };
      created.push(record);
      seedHubSignupDomain(domain, tenant);
      const displayName = options.displayName ?? `Region ${randomUUID()}`;
      const signedUp = await signup(
        request,
        tenant,
        record.email,
        record.keys,
        {
          displayName,
          ...(options.residentCountry === undefined
            ? {}
            : { residentCountry: options.residentCountry }),
        },
      );
      record.did = signedUp.hubUserDID;
      return {
        tenant,
        email: record.email,
        password: signedUp.password,
        handle: signedUp.handle,
        displayName,
        keys: record.keys,
      };
    });
    for (const record of created) {
      if (record.did !== undefined) cleanupHubAliasClaim(record.did);
      cleanupHubUser(record.email, record.tenant);
      cleanupHubIdempotency(record.keys, record.tenant);
      cleanupHubSignupDomain(record.domain, record.tenant);
    }
  },
  org: async ({ request }, use) => {
    const created: { tenant: TestTenant; domain: OrgDomain }[] = [];
    await use(async (tenant) => {
      const domain = uniqueOrgDomain();
      created.push({ tenant, domain });
      const org = await signupOrg(new OrgsAPI(request, tenant), domain);
      return { ...org, tenant };
    });
    for (const { tenant, domain } of created) {
      await deleteOrgVerificationRecord(domain);
      cleanupOrg(domain, tenant);
    }
  },
});

export { expect };
