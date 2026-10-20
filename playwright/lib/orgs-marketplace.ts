import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import type { Capability } from "typespec/orgs/marketplace/capabilities";
import type { Engagement } from "typespec/orgs/marketplace/engagements";
import type {
  CreateListingRequest,
  Listing,
  SearchListingsResponse,
} from "typespec/orgs/marketplace/listings";
import { globalSQLScalar, sqlLiteral, type TestTenant } from "./admin-db.ts";
import { deleteOrgVerificationRecord } from "./dev-dns.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgSQL,
  type SignedUpOrg,
  signupOrg,
} from "./orgs-api.ts";

// Shared fixtures of the marketplace API specs: Orgs on a paid plan in any
// region, their Listings, and the searches over them.

export const base = "vetchium-problem-details/";
export const problems = {
  authentication: `${base}org-authentication-required`,
  permission: `${base}org-permission-required`,
  suspended: `${base}org-suspended`,
  validation: `${base}validation-failed`,
  planRequired: `${base}org-listing-plan-required`,
  notFound: `${base}org-listing-not-found`,
  exists: `${base}org-listing-exists`,
  version: `${base}org-listing-version-conflict`,
  state: `${base}org-listing-state-conflict`,
  unavailable: `${base}org-tenant-unavailable`,
  paginationKey: `${base}invalid-pagination-key`,
  keyConflict: `${base}idempotency-key-conflict`,
  invalidJSON: `${base}invalid-json`,
};

export const moneyKey =
  /"[a-z_]*(amount|fee|rate|invoice|payment|currency)[a-z_]*":/;

export function content(
  headline = "Structured interviews",
  extra: Partial<CreateListingRequest> = {},
): Omit<CreateListingRequest, "capability"> {
  return {
    headline,
    description: "We run **structured** interviews.",
    service: { worldwide: false, countries: ["SG", "IN"] },
    languages: ["en"],
    indicative_price: "Quoted per engagement",
    ...extra,
  };
}

export function background(
  headline = "Background checks",
  extra: Partial<CreateListingRequest> = {},
): CreateListingRequest {
  return {
    capability: "background_check",
    ...content(headline),
    check_types: ["identity", "education"],
    consent_disclosure: "We verify what you tell us.",
    ...extra,
  };
}

export function listing(
  capability: Capability,
  headline = "Structured interviews",
  extra: Partial<CreateListingRequest> = {},
): CreateListingRequest {
  return { capability, ...content(headline), ...extra };
}

export async function onSilver(api: OrgsAPI, owner: string): Promise<void> {
  const response = await api.setSubscriptionPlan(owner, {
    plan_oid: "org-silver-tier",
    billing_interval: "month",
  });
  expect(response.status(), await response.text()).toBe(200);
}

export interface Provider {
  api: OrgsAPI;
  org: SignedUpOrg;
  owner: string;
  tenant: TestTenant;
}

export async function withProvider(
  request: ConstructorParameters<typeof OrgsAPI>[0],
  body: (provider: Provider) => Promise<void>,
  options: { tenant?: TestTenant; silver?: boolean; name?: string } = {},
): Promise<void> {
  const tenant = options.tenant ?? "sgp";
  const api = new OrgsAPI(request, tenant);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    if (options.silver !== false) await onSilver(api, owner);
    if (options.name !== undefined) setDisplayName(org, tenant, options.name);
    await body({ api, org, owner, tenant });
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain, tenant);
  }
}

export function setDisplayName(
  org: SignedUpOrg,
  tenant: TestTenant,
  name: string,
): void {
  orgSQL(
    `UPDATE vetchium.orgs SET display_name = '${name}'
     WHERE org_did = (SELECT org_did FROM vetchium.org_domains
                      WHERE domain = '${org.domain}')`,
    tenant,
  );
}

export async function created(
  api: OrgsAPI,
  token: string,
  body: CreateListingRequest,
): Promise<Listing> {
  const response = await api.createListing(token, body);
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as Listing;
}

export async function published(
  api: OrgsAPI,
  token: string,
  body: CreateListingRequest,
): Promise<Listing> {
  const draft = await created(api, token, body);
  const response = await api.publishListing(token, {
    capability: draft.capability,
    version: draft.version,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as Listing;
}

export async function search(
  api: OrgsAPI,
  token: string,
  body: Parameters<OrgsAPI["searchListings"]>[1],
): Promise<SearchListingsResponse> {
  const response = await api.searchListings(token, body);
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as SearchListingsResponse;
}

export const domainsOf = (response: SearchListingsResponse) =>
  response.listings.map((item) => item.provider.domain);

export function unique(): string {
  return `lst${randomUUID().slice(0, 8)}`;
}

/**
 * Points the directory's route to an Org at `tenant`, so a command about the
 * Org goes there: `gone` never receives it, and a real tenant that does not
 * home the Org refuses it. Naming the current tenant changes nothing: the
 * directory refuses a new route version without a handover.
 */
export function setOrgHome(orgDID: string, tenant: string): void {
  globalSQLScalar(
    `UPDATE vetchium.org_principals
     SET home_tenant_id = ${sqlLiteral(tenant)},
       routing_version = routing_version + 1
     WHERE org_did = ${sqlLiteral(orgDID)}::uuid
       AND home_tenant_id <> ${sqlLiteral(tenant)}`,
  );
}

export interface Pair {
  consumer: Provider;
  provider: Provider;
}

/**
 * A consumer Org and a provider Org, each on Silver in its own region. The
 * provider has published a Listing for every Capability named.
 */
export async function withPair(
  request: ConstructorParameters<typeof OrgsAPI>[0],
  options: {
    consumer?: TestTenant;
    provider?: TestTenant;
    capabilities?: Capability[];
  },
  body: (pair: Pair) => Promise<void>,
): Promise<void> {
  await withProvider(
    request,
    async (consumer) => {
      await withProvider(
        request,
        async (provider) => {
          for (const capability of options.capabilities ?? ["sourcing"]) {
            await published(
              provider.api,
              provider.owner,
              capability === "background_check"
                ? background("Checks")
                : listing(capability, `${capability} services`),
            );
          }
          await body({ consumer, provider });
        },
        { tenant: options.provider ?? "deu" },
      );
    },
    { tenant: options.consumer ?? "sgp" },
  );
}

export async function propose(
  { consumer, provider }: Pair,
  capability: Capability = "sourcing",
  message?: string,
): Promise<Engagement> {
  const response = await consumer.api.proposeEngagement(consumer.owner, {
    provider_domain: provider.org.domain,
    capability,
    ...(message === undefined ? {} : { message }),
  });
  expect(response.status(), await response.text()).toBe(201);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as Engagement;
}

export async function asConsumer(
  { consumer }: Pair,
  id: string,
): Promise<Engagement> {
  const response = await consumer.api.getEngagement(consumer.owner, {
    engagement_id: id,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as Engagement;
}

/**
 * The provider's view, once its tenant has received the consumer's change at
 * `version` or later.
 */
export async function asProvider(
  { provider }: Pair,
  id: string,
  version: number,
): Promise<Engagement> {
  let latest: Engagement | undefined;
  await expect
    .poll(
      async () => {
        const response = await provider.api.getClientEngagement(
          provider.owner,
          { engagement_id: id },
        );
        if (response.status() !== 200) return 0;
        latest = (await response.json()) as Engagement;
        return latest.version;
      },
      { timeout: 30_000, intervals: [250, 500, 1000] },
    )
    .toBeGreaterThanOrEqual(version);
  if (latest === undefined) throw new Error("the projection never arrived");
  return latest;
}

/**
 * Proposes `capability` to the provider and has the provider accept it,
 * returning the active engagement as the consumer sees it.
 */
export async function activate(
  pair: Pair,
  capability: Capability = "sourcing",
): Promise<Engagement> {
  const proposed = await propose(pair, capability);
  await asProvider(pair, proposed.id, 1);
  const accepted = await pair.provider.api.acceptEngagement(
    pair.provider.owner,
    { engagement_id: proposed.id, version: 1 },
  );
  expect(accepted.status(), await accepted.text()).toBe(200);
  return asConsumer(pair, proposed.id);
}
