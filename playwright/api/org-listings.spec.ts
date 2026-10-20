import { randomUUID } from "node:crypto";
import type { Capability } from "typespec/orgs/marketplace/capabilities";
import type {
  CreateListingRequest,
  Listing,
  ListingDetail,
  SearchListingsRequest,
  SearchListingsResponse,
} from "typespec/orgs/marketplace/listings";
import { expectProblem } from "../lib/admin-api.ts";
import { globalSQLScalar, type TestTenant } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import { makePNG } from "../lib/logo-fixtures.ts";
import { meshPeerRequest, meshRelayRequest } from "../lib/mesh.ts";
import {
  addOrgMember,
  cleanupOrg,
  inviteeAddress,
  loginOrg,
  OrgsAPI,
  orgAuditEventsByKey,
  orgSQL,
  orgsIdempotencyKey,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";

const base = "vetchium-problem-details/";
const problems = {
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

// A second sgp API process whose region catalog also names `gone`, a tenant
// that never answers.
const unavailableOrigin = "http://127.0.0.1:18084";

const moneyKey = /"[a-z_]*(amount|fee|rate|invoice|payment|currency)[a-z_]*":/;

function content(
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

function background(
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

function listing(
  capability: Capability,
  headline = "Structured interviews",
  extra: Partial<CreateListingRequest> = {},
): CreateListingRequest {
  return { capability, ...content(headline), ...extra };
}

async function onSilver(api: OrgsAPI, owner: string): Promise<void> {
  const response = await api.setSubscriptionPlan(owner, {
    plan_oid: "org-silver-tier",
    billing_interval: "month",
  });
  expect(response.status(), await response.text()).toBe(200);
}

interface Provider {
  api: OrgsAPI;
  org: SignedUpOrg;
  owner: string;
  tenant: TestTenant;
}

async function withProvider(
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

function setDisplayName(
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

async function created(
  api: OrgsAPI,
  token: string,
  body: CreateListingRequest,
): Promise<Listing> {
  const response = await api.createListing(token, body);
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as Listing;
}

async function published(
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

async function search(
  api: OrgsAPI,
  token: string,
  body: Parameters<OrgsAPI["searchListings"]>[1],
): Promise<SearchListingsResponse> {
  const response = await api.searchListings(token, body);
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as SearchListingsResponse;
}

const domainsOf = (response: SearchListingsResponse) =>
  response.listings.map((item) => item.provider.domain);

function unique(): string {
  return `lst${randomUUID().slice(0, 8)}`;
}

test("a Listing is created, listed, edited, published, unlisted, and deleted", async ({
  request,
}) => {
  await withProvider(request, async ({ api, owner }) => {
    expect(
      ((await (await api.listListings(owner)).json()) as { listings: [] })
        .listings,
    ).toEqual([]);

    const createKey = orgsIdempotencyKey();
    const body = listing("interviewing", "  Structured interviews  ");
    const response = await api.createListing(owner, body, createKey);
    expect(response.status(), await response.text()).toBe(201);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const draft = (await response.json()) as Listing;
    expect(draft).toMatchObject({
      capability: "interviewing",
      state: "draft",
      version: 1,
      headline: "Structured interviews",
      service: { worldwide: false, countries: ["SG", "IN"] },
      languages: ["en"],
      indicative_price: "Quoted per engagement",
    });
    expect(draft.check_types).toBeUndefined();
    expect(draft.consent_disclosure).toBeUndefined();

    const replay = await api.createListing(owner, body, createKey);
    expect(replay.status(), await replay.text()).toBe(201);
    expect(await replay.json()).toEqual(draft);
    const events = orgAuditEventsByKey(createKey);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "org.listing.created",
      entity_type: "org_listing",
    });
    expect(JSON.stringify(events)).not.toContain("Structured interviews");
    await expectProblem(
      await api.createListing(
        owner,
        listing("interviewing", "Different"),
        createKey,
      ),
      409,
      problems.keyConflict,
    );

    const updateKey = orgsIdempotencyKey();
    const edited = listing("interviewing", "Panel interviews", {
      service: { worldwide: true, countries: [] },
      languages: [],
    });
    const updatedResponse = await api.updateListing(
      owner,
      { ...edited, version: draft.version },
      updateKey,
    );
    expect(updatedResponse.status(), await updatedResponse.text()).toBe(200);
    expect(updatedResponse.headers()["cache-control"]).toBe("no-store");
    const updated = (await updatedResponse.json()) as Listing;
    expect(updated).toMatchObject({
      state: "draft",
      version: 2,
      headline: "Panel interviews",
      service: { worldwide: true, countries: [] },
      languages: [],
      created_at: draft.created_at,
    });
    const updateEvents = orgAuditEventsByKey(updateKey);
    expect(updateEvents).toHaveLength(1);
    expect(updateEvents[0]?.payload).toMatchObject({
      action: "updated",
      changed_fields: ["headline", "service", "languages"],
    });
    expect(JSON.stringify(updateEvents)).not.toContain("Panel interviews");

    await expectProblem(
      await api.updateListing(
        owner,
        { ...edited, headline: "Other", version: draft.version },
        updateKey,
      ),
      409,
      problems.keyConflict,
    );

    const publishKey = orgsIdempotencyKey();
    const publishedResponse = await api.publishListing(
      owner,
      { capability: "interviewing", version: updated.version },
      publishKey,
    );
    expect(publishedResponse.status(), await publishedResponse.text()).toBe(
      200,
    );
    const listed = (await publishedResponse.json()) as Listing;
    expect(listed).toMatchObject({ state: "listed", version: 3 });
    expect(orgAuditEventsByKey(publishKey)[0]?.action).toBe(
      "org.listing.listed",
    );
    await expectProblem(
      await api.publishListing(
        owner,
        { capability: "assessment", version: updated.version },
        publishKey,
      ),
      409,
      problems.keyConflict,
    );

    const unlistKey = orgsIdempotencyKey();
    const unlistedResponse = await api.unlistListing(
      owner,
      { capability: "interviewing", version: listed.version },
      unlistKey,
    );
    expect(unlistedResponse.status(), await unlistedResponse.text()).toBe(200);
    const unlisted = (await unlistedResponse.json()) as Listing;
    expect(unlisted).toMatchObject({ state: "unlisted", version: 4 });
    expect(orgAuditEventsByKey(unlistKey)[0]?.action).toBe(
      "org.listing.unlisted",
    );
    await expectProblem(
      await api.unlistListing(
        owner,
        { capability: "assessment", version: listed.version },
        unlistKey,
      ),
      409,
      problems.keyConflict,
    );

    const again = await api.publishListing(owner, {
      capability: "interviewing",
      version: unlisted.version,
    });
    expect(again.status(), await again.text()).toBe(200);
    expect(((await again.json()) as Listing).state).toBe("listed");

    const all = (await (await api.listListings(owner)).json()) as {
      listings: Listing[];
    };
    expect(all.listings).toMatchObject([
      { capability: "interviewing", state: "listed", version: 5 },
    ]);
    expect(JSON.stringify(all)).not.toMatch(moneyKey);

    const other = await created(api, owner, listing("sourcing", "Sourcing"));
    const deleteKey = orgsIdempotencyKey();
    const deleted = await api.deleteListing(
      owner,
      { capability: "sourcing", version: other.version },
      deleteKey,
    );
    expect(deleted.status(), await deleted.text()).toBe(204);
    expect(deleted.headers()["cache-control"]).toBe("no-store");
    expect(orgAuditEventsByKey(deleteKey)[0]?.action).toBe(
      "org.listing.deleted",
    );
    await expectProblem(
      await api.deleteListing(
        owner,
        { capability: "assessment", version: other.version },
        deleteKey,
      ),
      409,
      problems.keyConflict,
    );
    const remaining = (await (await api.listListings(owner)).json()) as {
      listings: Listing[];
    };
    expect(remaining.listings.map((item) => item.capability)).toEqual([
      "interviewing",
    ]);
  });
});

test("a background-check Listing keeps its check types and consent disclosure", async ({
  request,
}) => {
  await withProvider(request, async ({ api, owner }) => {
    const draft = await created(api, owner, background());
    expect(draft).toMatchObject({
      capability: "background_check",
      check_types: ["identity", "education"],
      consent_disclosure: "We verify what you tell us.",
    });
    const response = await api.updateListing(owner, {
      ...background("Checks", {
        check_types: ["criminal"],
        consent_disclosure: "  Updated disclosure  ",
      }),
      version: draft.version,
    });
    expect(response.status(), await response.text()).toBe(200);
    expect(await response.json()).toMatchObject({
      check_types: ["criminal"],
      consent_disclosure: "Updated disclosure",
    });
  });
});

test("Listing content is validated for every Capability", async ({
  request,
}) => {
  await withProvider(request, async ({ api, owner }) => {
    const text = (length: number) => "é".repeat(length);
    const cases: {
      name: string;
      body: unknown;
      fields: string[];
    }[] = [
      {
        name: "unknown Capability",
        body: { ...listing("sourcing"), capability: "plumbing" },
        fields: ["capability"],
      },
      {
        name: "blank headline",
        body: listing("sourcing", ""),
        fields: ["headline"],
      },
      {
        name: "headline over 200",
        body: listing("sourcing", text(201)),
        fields: ["headline"],
      },
      {
        name: "NUL in headline",
        body: listing("sourcing", "a\u0000b"),
        fields: ["headline"],
      },
      {
        name: "description over 10000",
        body: listing("sourcing", "H", { description: text(10001) }),
        fields: ["description"],
      },
      {
        name: "worldwide with countries",
        body: listing("sourcing", "H", {
          service: { worldwide: true, countries: ["SG"] },
        }),
        fields: ["service.countries"],
      },
      {
        name: "no countries",
        body: listing("sourcing", "H", {
          service: { worldwide: false, countries: [] },
        }),
        fields: ["service.countries"],
      },
      {
        name: "duplicate countries",
        body: listing("sourcing", "H", {
          service: { worldwide: false, countries: ["SG", "SG"] },
        }),
        fields: ["service.countries"],
      },
      {
        name: "unknown country",
        body: listing("sourcing", "H", {
          service: { worldwide: false, countries: ["ZZ"] },
        }),
        fields: ["service.countries"],
      },
      {
        name: "unknown language",
        body: listing("sourcing", "H", { languages: ["xx-nope"] }),
        fields: ["languages"],
      },
      {
        name: "too many languages",
        body: listing("sourcing", "H", {
          languages: Array.from({ length: 21 }, () => "en"),
        }),
        fields: ["languages"],
      },
      {
        name: "price over 500",
        body: listing("sourcing", "H", { indicative_price: text(501) }),
        fields: ["indicative_price"],
      },
      {
        name: "check types on interviewing",
        body: listing("interviewing", "H", { check_types: ["identity"] }),
        fields: ["check_types"],
      },
      {
        name: "disclosure on assessment",
        body: listing("assessment", "H", { consent_disclosure: "x" }),
        fields: ["consent_disclosure"],
      },
      {
        name: "background check without either",
        body: listing("background_check"),
        fields: ["check_types", "consent_disclosure"],
      },
      {
        name: "unknown check type",
        body: background("H", { check_types: ["dna"] as never }),
        fields: ["check_types"],
      },
      {
        name: "duplicate check types",
        body: background("H", { check_types: ["drug", "drug"] }),
        fields: ["check_types"],
      },
      {
        name: "disclosure over 5000",
        body: background("H", { consent_disclosure: text(5001) }),
        fields: ["consent_disclosure"],
      },
    ];
    for (const item of cases) {
      const response = await api.listingWriteRaw(
        "/create-listing",
        owner,
        item.body,
      );
      await expectProblem(response, 400, problems.validation, item.fields);
      const update = await api.listingWriteRaw("/update-listing", owner, {
        ...(item.body as object),
        version: 1,
      });
      await expectProblem(update, 400, problems.validation, item.fields);
    }
    await expectProblem(
      await api.listingWriteRaw("/update-listing", owner, {
        ...listing("sourcing"),
        version: 0,
      }),
      400,
      problems.validation,
      ["version"],
    );
    for (const path of [
      "/publish-listing",
      "/unlist-listing",
      "/delete-listing",
    ]) {
      await expectProblem(
        await api.listingWriteRaw(path, owner, {
          capability: "nope",
          version: 0,
        }),
        400,
        problems.validation,
        ["capability", "version"],
      );
    }
    const none = (await (await api.listListings(owner)).json()) as {
      listings: Listing[];
    };
    expect(none.listings).toEqual([]);
  });
});

test("Listing writes name their conflicts", async ({ request }) => {
  await withProvider(request, async ({ api, owner }) => {
    const draft = await created(api, owner, listing("assessment", "Tests"));
    await expectProblem(
      await api.createListing(owner, listing("assessment", "Again")),
      409,
      problems.exists,
    );

    const stale = draft.version + 1;
    await expectProblem(
      await api.updateListing(owner, {
        ...listing("assessment", "Edited"),
        version: stale,
      }),
      409,
      problems.version,
    );
    await expectProblem(
      await api.publishListing(owner, {
        capability: "assessment",
        version: stale,
      }),
      409,
      problems.version,
    );
    await expectProblem(
      await api.unlistListing(owner, {
        capability: "assessment",
        version: stale,
      }),
      409,
      problems.version,
    );
    await expectProblem(
      await api.deleteListing(owner, {
        capability: "assessment",
        version: stale,
      }),
      409,
      problems.version,
    );

    await expectProblem(
      await api.unlistListing(owner, {
        capability: "assessment",
        version: draft.version,
      }),
      409,
      problems.state,
    );
    const listed = await published(api, owner, listing("sourcing", "Sourcing"));
    await expectProblem(
      await api.publishListing(owner, {
        capability: "sourcing",
        version: listed.version,
      }),
      409,
      problems.state,
    );
    await expectProblem(
      await api.deleteListing(owner, {
        capability: "sourcing",
        version: listed.version,
      }),
      409,
      problems.state,
    );

    const missing = { capability: "interviewing" as const, version: 1 };
    await expectProblem(
      await api.updateListing(owner, {
        ...listing("interviewing"),
        version: 1,
      }),
      404,
      problems.notFound,
    );
    await expectProblem(
      await api.publishListing(owner, missing),
      404,
      problems.notFound,
    );
    await expectProblem(
      await api.unlistListing(owner, missing),
      404,
      problems.notFound,
    );
    await expectProblem(
      await api.deleteListing(owner, missing),
      404,
      problems.notFound,
    );

    const untouched = (await (await api.listListings(owner)).json()) as {
      listings: Listing[];
    };
    expect(
      untouched.listings.map((item) => [item.capability, item.version]),
    ).toEqual([
      ["assessment", draft.version],
      ["sourcing", listed.version],
    ]);
  });
});

test("two concurrent creations of one Listing make exactly one", async ({
  request,
}) => {
  await withProvider(request, async ({ api, owner }) => {
    const responses = await Promise.all([
      api.createListing(owner, listing("sourcing", "First")),
      api.createListing(owner, listing("sourcing", "Second")),
    ]);
    const statuses = responses.map((response) => response.status()).sort();
    expect(statuses).toEqual([201, 409]);
    const loser = responses.find((response) => response.status() === 409);
    if (loser === undefined) throw new Error("no conflict");
    await expectProblem(loser, 409, problems.exists);
  });
});

test("Listings need a plan that allows them, and a downgrade unlists them", async ({
  request,
}) => {
  await withProvider(
    request,
    async ({ api, owner }) => {
      await expectProblem(
        await api.createListing(owner, listing("sourcing")),
        403,
        problems.planRequired,
      );
      await onSilver(api, owner);
      const draft = await created(api, owner, listing("sourcing", "Sourcing"));
      const stays = await created(api, owner, listing("assessment", "Tests"));
      const live = await published(
        api,
        owner,
        listing("interviewing", "Interviews"),
      );

      const downgradeKey = orgsIdempotencyKey();
      const downgrade = await api.setSubscriptionPlan(
        owner,
        { plan_oid: "org-free-tier" },
        downgradeKey,
      );
      expect(downgrade.status(), await downgrade.text()).toBe(200);
      const after = (await (await api.listListings(owner)).json()) as {
        listings: Listing[];
      };
      const byCapability = Object.fromEntries(
        after.listings.map((item) => [item.capability, item]),
      );
      expect(byCapability.interviewing).toMatchObject({
        state: "unlisted",
        version: live.version + 1,
      });
      expect(byCapability.sourcing?.state).toBe("draft");
      expect(byCapability.assessment?.state).toBe("draft");
      expect(
        orgAuditEventsByKey(downgradeKey).map((event) => event.action),
      ).toContain("org.listing.unlisted_by_plan");
      expect(
        orgAuditEventsByKey(downgradeKey).filter(
          (event) => event.action === "org.listing.unlisted_by_plan",
        ),
      ).toHaveLength(1);

      await expectProblem(
        await api.createListing(owner, background()),
        403,
        problems.planRequired,
      );
      await expectProblem(
        await api.updateListing(owner, {
          ...listing("sourcing", "Edited"),
          version: draft.version,
        }),
        403,
        problems.planRequired,
      );
      await expectProblem(
        await api.publishListing(owner, {
          capability: "sourcing",
          version: draft.version,
        }),
        403,
        problems.planRequired,
      );
      await expectProblem(
        await api.deleteListing(owner, {
          capability: "interviewing",
          version: live.version + 1,
        }),
        409,
        problems.state,
      );
      const deleted = await api.deleteListing(owner, {
        capability: "assessment",
        version: stays.version,
      });
      expect(deleted.status(), await deleted.text()).toBe(204);

      await onSilver(api, owner);
      const restored = await api.publishListing(owner, {
        capability: "interviewing",
        version: live.version + 1,
      });
      expect(restored.status(), await restored.text()).toBe(200);
    },
    { silver: false },
  );
});

test("Listing routes authenticate, authorize, validate, and refuse suspended Orgs", async ({
  request,
}) => {
  await withProvider(request, async ({ api, owner, org }) => {
    const draft = await created(api, owner, listing("sourcing", "Sourcing"));
    const target = { capability: "sourcing", version: draft.version };
    const routes: { path: string; body: object; write: boolean }[] = [
      { path: "/list-listings", body: {}, write: false },
      { path: "/create-listing", body: listing("assessment"), write: true },
      {
        path: "/update-listing",
        body: { ...listing("sourcing"), version: draft.version },
        write: true,
      },
      { path: "/publish-listing", body: target, write: true },
      { path: "/unlist-listing", body: target, write: true },
      { path: "/delete-listing", body: target, write: true },
      {
        path: "/search-listings",
        body: { capability: "sourcing" },
        write: false,
      },
      {
        path: "/get-listing",
        body: { domain: org.domain, capability: "sourcing" },
        write: false,
      },
    ];
    const providerOnly = routes.filter((route) =>
      [
        "/list-listings",
        "/create-listing",
        "/update-listing",
        "/publish-listing",
        "/unlist-listing",
        "/delete-listing",
      ].includes(route.path),
    );
    const consumerOnly = routes.filter((route) =>
      ["/search-listings", "/get-listing"].includes(route.path),
    );
    for (const route of routes) {
      const options = route.write
        ? { idempotencyKey: orgsIdempotencyKey() }
        : {};
      const unauthenticated = await api.post(route.path, route.body, options);
      await expectProblem(unauthenticated, 401, problems.authentication);
      const malformed = await api.postRaw(route.path, "{", {
        token: owner,
        ...options,
      });
      await expectProblem(malformed, 400, problems.invalidJSON);
    }
    for (const route of routes.filter((item) => item.write)) {
      const missingKey = await api.post(route.path, route.body, {
        token: owner,
      });
      expect(
        missingKey.status(),
        `${route.path}: ${await missingKey.text()}`,
      ).toBe(400);
    }
    for (const route of [
      { path: "/search-listings", body: {} },
      { path: "/get-listing", body: { domain: "x", capability: "sourcing" } },
    ]) {
      await expectProblem(
        await api.post(route.path, route.body, { token: owner }),
        400,
        problems.validation,
      );
    }

    const lister = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain, "lister"),
      ["org:manage_listings"],
    );
    const buyer = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain, "buyer"),
      ["org:manage_providers"],
    );
    const plain = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain, "plain"),
      [],
    );
    const attempt = (route: (typeof routes)[number], token: string) =>
      api.post(route.path, route.body, {
        token,
        ...(route.write ? { idempotencyKey: orgsIdempotencyKey() } : {}),
      });
    for (const route of routes) {
      await expectProblem(
        await attempt(route, plain.token),
        403,
        problems.permission,
      );
    }
    for (const route of consumerOnly) {
      await expectProblem(
        await attempt(route, lister.token),
        403,
        problems.permission,
      );
    }
    for (const route of providerOnly) {
      await expectProblem(
        await attempt(route, buyer.token),
        403,
        problems.permission,
      );
    }
    const route = (path: string) => {
      const found = routes.find((item) => item.path === path);
      if (found === undefined) throw new Error(`no route ${path}`);
      return found;
    };
    const ownList = await attempt(route("/list-listings"), lister.token);
    expect(ownList.status(), await ownList.text()).toBe(200);
    const ownSearch = await attempt(route("/search-listings"), buyer.token);
    expect(ownSearch.status(), await ownSearch.text()).toBe(200);

    orgSQL(`UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
      WHERE org_did = (SELECT org_did FROM vetchium.org_domains
        WHERE domain = '${org.domain}')`);
    for (const route of routes) {
      await expectProblem(await attempt(route, owner), 403, problems.suspended);
    }
  });
});

test("Listing search merges regions in name order and paginates", async ({
  request,
}) => {
  const token = unique();
  await withProvider(
    request,
    async (sgp) => {
      await withProvider(
        request,
        async (deu) => {
          await withProvider(
            request,
            async (usa) => {
              await published(
                sgp.api,
                sgp.owner,
                background(`${token} sgp checks`),
              );
              await published(
                deu.api,
                deu.owner,
                background(`${token} deu checks`, {
                  service: { worldwide: true, countries: [] },
                  languages: ["de"],
                  check_types: ["criminal", "identity"],
                }),
              );
              await published(
                usa.api,
                usa.owner,
                background(`${token} usa checks`, {
                  languages: ["en", "de"],
                  check_types: ["drug"],
                }),
              );
              // Not in the Capability searched, and not published.
              await published(
                sgp.api,
                sgp.owner,
                listing("interviewing", `${token} interviews`),
              );
              await created(
                deu.api,
                deu.owner,
                listing("sourcing", `${token} draft`),
              );

              const everything = await search(sgp.api, sgp.owner, {
                capability: "background_check",
                query: token,
              });
              expect(domainsOf(everything)).toEqual([
                sgp.org.domain,
                deu.org.domain,
                usa.org.domain,
              ]);
              expect(everything.unavailable_tenants).toEqual([]);
              expect(everything.next_pagination_key).toBeUndefined();
              expect(everything.listings[0]).toMatchObject({
                provider: {
                  domain: sgp.org.domain,
                  display_name: `${token} Alpha`,
                  country: "SG",
                },
                capability: "background_check",
                headline: `${token} sgp checks`,
                service: { worldwide: false, countries: ["SG", "IN"] },
                check_types: ["identity", "education"],
              });
              expect(everything.listings[0]?.provider.logo_url).toBeUndefined();
              expect(JSON.stringify(everything)).not.toMatch(moneyKey);
              expect(JSON.stringify(everything)).not.toMatch(
                /consent_disclosure|description|org_did|version|state|email/,
              );
              // Any Org finds the same providers, from any region.
              for (const caller of [deu, usa]) {
                expect(
                  domainsOf(
                    await search(caller.api, caller.owner, {
                      capability: "background_check",
                      query: token,
                    }),
                  ),
                ).toEqual(domainsOf(everything));
              }

              const firstPage = await search(sgp.api, sgp.owner, {
                capability: "background_check",
                query: token,
                limit: 2,
              });
              expect(domainsOf(firstPage)).toEqual([
                sgp.org.domain,
                deu.org.domain,
              ]);
              const key = firstPage.next_pagination_key;
              if (key === undefined) throw new Error("missing pagination key");
              const secondPage = await search(sgp.api, sgp.owner, {
                capability: "background_check",
                query: token,
                limit: 2,
                pagination_key: key,
              });
              expect(domainsOf(secondPage)).toEqual([usa.org.domain]);
              expect(secondPage.next_pagination_key).toBeUndefined();
              const single = await search(sgp.api, sgp.owner, {
                capability: "background_check",
                query: token,
                limit: 1,
              });
              expect(domainsOf(single)).toEqual([sgp.org.domain]);
              expect(single.next_pagination_key).toBeDefined();

              await expectProblem(
                await sgp.api.searchListings(sgp.owner, {
                  capability: "background_check",
                  query: `${token}x`,
                  limit: 2,
                  pagination_key: key,
                }),
                400,
                problems.paginationKey,
              );
              await expectProblem(
                await sgp.api.searchListings(sgp.owner, {
                  capability: "background_check",
                  query: token,
                  limit: 2,
                  country: "SG",
                  pagination_key: key,
                }),
                400,
                problems.paginationKey,
              );
              await expectProblem(
                await sgp.api.searchListings(sgp.owner, {
                  capability: "background_check",
                  query: token,
                  limit: 2,
                  pagination_key: `${key}x`,
                }),
                400,
                problems.paginationKey,
              );
            },
            { tenant: "usa1", name: `${token} Gamma` },
          );
        },
        { tenant: "deu", name: `${token} Beta` },
      );
    },
    { name: `${token} Alpha` },
  );
});

test("Listing search filters by country, language, check types, and text", async ({
  request,
}) => {
  const token = unique();
  await withProvider(
    request,
    async (sgp) => {
      await withProvider(
        request,
        async (deu) => {
          await published(
            sgp.api,
            sgp.owner,
            background(`${token} identity and education`, {
              service: { worldwide: false, countries: ["SG"] },
              languages: ["en"],
            }),
          );
          await published(
            deu.api,
            deu.owner,
            background(`${token} criminal records`, {
              service: { worldwide: true, countries: [] },
              languages: ["de"],
              check_types: ["criminal", "identity"],
            }),
          );
          const run = async (extra: Partial<SearchListingsRequest>) =>
            domainsOf(
              await search(sgp.api, sgp.owner, {
                capability: "background_check",
                query: token,
                ...extra,
              }),
            );
          expect(await run({})).toEqual([sgp.org.domain, deu.org.domain]);
          expect(await run({ country: "SG" })).toEqual([
            sgp.org.domain,
            deu.org.domain,
          ]);
          expect(await run({ country: "IN" })).toEqual([deu.org.domain]);
          expect(await run({ language: "de" })).toEqual([deu.org.domain]);
          expect(await run({ language: "en" })).toEqual([sgp.org.domain]);
          expect(await run({ language: "fr" })).toEqual([]);
          expect(await run({ check_types: ["identity"] })).toEqual([
            sgp.org.domain,
            deu.org.domain,
          ]);
          expect(await run({ check_types: ["criminal"] })).toEqual([
            deu.org.domain,
          ]);
          expect(await run({ check_types: ["identity", "education"] })).toEqual(
            [sgp.org.domain],
          );
          expect(await run({ check_types: ["drug"] })).toEqual([]);
          expect(await run({ query: token.toUpperCase() })).toEqual([
            sgp.org.domain,
            deu.org.domain,
          ]);
          // The text matches a headline as well as a provider name.
          expect(await run({ query: `${token} CRIMINAL` })).toEqual([
            deu.org.domain,
          ]);
          expect(await run({ query: `${token} identity and edu` })).toEqual([
            sgp.org.domain,
          ]);
          expect(await run({ query: `${token} B` })).toEqual([deu.org.domain]);
          expect(await run({ query: `${token} nothing like it` })).toEqual([]);
          expect(
            domainsOf(
              await search(sgp.api, sgp.owner, {
                capability: "sourcing",
                query: token,
              }),
            ),
          ).toEqual([]);
          for (const body of [
            { capability: "sourcing", check_types: ["identity"] },
            { capability: "background_check", check_types: [] },
            { capability: "background_check", query: "a" },
            { capability: "background_check", query: "ab\u0000" },
            { capability: "background_check", country: "ZZ" },
            { capability: "background_check", language: "xx-nope" },
            { capability: "background_check", limit: 51 },
            { capability: "plumbing" },
            {},
          ]) {
            await expectProblem(
              await sgp.api.post("/search-listings", body, {
                token: sgp.owner,
              }),
              400,
              problems.validation,
            );
          }
        },
        { tenant: "deu", name: `${token} B` },
      );
    },
    { name: `${token} A` },
  );
});

test("Listing search hides providers that are not listed, active, or on a plan with Listings", async ({
  request,
}) => {
  const token = unique();
  await withProvider(
    request,
    async (visible) => {
      await withProvider(
        request,
        async (hidden) => {
          await published(
            visible.api,
            visible.owner,
            listing("assessment", "Visible"),
          );
          const live = await published(
            hidden.api,
            hidden.owner,
            listing("assessment", "Hidden"),
          );
          const find = async () =>
            domainsOf(
              await search(visible.api, visible.owner, {
                capability: "assessment",
                query: token,
              }),
            );
          expect(await find()).toEqual([visible.org.domain, hidden.org.domain]);

          const unlisted = await hidden.api.unlistListing(hidden.owner, {
            capability: "assessment",
            version: live.version,
          });
          expect(unlisted.status(), await unlisted.text()).toBe(200);
          expect(await find()).toEqual([visible.org.domain]);
          const relisted = await hidden.api.publishListing(hidden.owner, {
            capability: "assessment",
            version: live.version + 1,
          });
          expect(relisted.status(), await relisted.text()).toBe(200);
          expect(await find()).toEqual([visible.org.domain, hidden.org.domain]);

          const suspend = (state: "suspended" | "active") =>
            orgSQL(
              `UPDATE vetchium.orgs SET org_state = '${state}',
                 suspended_at = ${state === "suspended" ? "now()" : "NULL"}
               WHERE org_did = (SELECT org_did FROM vetchium.org_domains
                 WHERE domain = '${hidden.org.domain}')`,
              "deu",
            );
          suspend("suspended");
          expect(await find()).toEqual([visible.org.domain]);
          suspend("active");
          expect(await find()).toEqual([visible.org.domain, hidden.org.domain]);

          // A plan without Listings leaves search even if a row stayed listed.
          orgSQL(
            `UPDATE vetchium.orgs SET org_plan_oid = 'org-free-tier',
               org_billing_interval = NULL
             WHERE org_did = (SELECT org_did FROM vetchium.org_domains
               WHERE domain = '${hidden.org.domain}')`,
            "deu",
          );
          expect(await find()).toEqual([visible.org.domain]);
        },
        { tenant: "deu", name: `${token} B hidden` },
      );
    },
    { name: `${token} A visible` },
  );
});

test("Listing search names a tenant that does not answer", async ({
  request,
}) => {
  const token = unique();
  await withProvider(
    request,
    async (provider) => {
      await published(
        provider.api,
        provider.owner,
        listing("sourcing", "Sourcing"),
      );
      const degraded = new OrgsAPI(request, "sgp", unavailableOrigin);
      const response = await search(degraded, provider.owner, {
        capability: "sourcing",
        query: token,
      });
      expect(response.unavailable_tenants).toEqual(["gone"]);
      expect(domainsOf(response)).toEqual([provider.org.domain]);
      const healthy = await search(provider.api, provider.owner, {
        capability: "sourcing",
        query: token,
      });
      expect(healthy.unavailable_tenants).toEqual([]);
    },
    { name: `${token} Provider` },
  );
});

test("Listing detail reads local and remote providers", async ({ request }) => {
  const token = unique();
  await withProvider(
    request,
    async (local) => {
      await withProvider(
        request,
        async (remote) => {
          await published(local.api, local.owner, background("Local checks"));
          const remoteBody = background("Remote checks", { languages: ["de"] });
          delete remoteBody.indicative_price;
          await published(remote.api, remote.owner, remoteBody);
          for (const target of [local, remote]) {
            const response = await local.api.getListing(local.owner, {
              domain: target.org.domain,
              capability: "background_check",
            });
            expect(response.status(), await response.text()).toBe(200);
            expect(response.headers()["cache-control"]).toBe("no-store");
            const detail = (await response.json()) as ListingDetail;
            expect(detail).toMatchObject({
              provider: {
                domain: target.org.domain,
                display_name: `${token} ${target === local ? "Local" : "Remote"}`,
                country: "SG",
              },
              capability: "background_check",
              description: "We run **structured** interviews.",
              check_types: ["identity", "education"],
              consent_disclosure: "We verify what you tell us.",
            });
            expect(JSON.stringify(detail)).not.toMatch(moneyKey);
            expect(JSON.stringify(detail)).not.toMatch(/org_did|version|state/);
          }
          const remoteDetail = (await (
            await remote.api.getListing(remote.owner, {
              domain: remote.org.domain,
              capability: "background_check",
            })
          ).json()) as ListingDetail;
          expect(remoteDetail.indicative_price).toBeUndefined();
          const sameFromRemote = await remote.api.getListing(remote.owner, {
            domain: local.org.domain,
            capability: "background_check",
          });
          expect(sameFromRemote.status(), await sameFromRemote.text()).toBe(
            200,
          );

          await expectProblem(
            await local.api.getListing(local.owner, {
              domain: local.org.domain,
              capability: "sourcing",
            }),
            404,
            problems.notFound,
          );
          await expectProblem(
            await local.api.getListing(local.owner, {
              domain: "nobody.example.test",
              capability: "background_check",
            }),
            404,
            problems.notFound,
          );
          const draft = await created(
            remote.api,
            remote.owner,
            listing("interviewing", "Draft"),
          );
          await expectProblem(
            await local.api.getListing(local.owner, {
              domain: remote.org.domain,
              capability: "interviewing",
            }),
            404,
            problems.notFound,
          );
          expect(draft.state).toBe("draft");
        },
        { tenant: "deu", name: `${token} Remote` },
      );
    },
    { name: `${token} Local` },
  );
});

test("Listing detail names a provider whose tenant does not answer", async ({
  request,
}) => {
  const domain = `${unique()}.example.com`;
  const did = `01900000-0000-7000-8000-${randomUUID().slice(-12)}`;
  globalSQLScalar(
    `INSERT INTO vetchium.org_principals (
       org_did, home_tenant_id, state, provisioning_operation_id, activated_at
     ) VALUES ('${did}', 'gone', 'active', '${randomUUID()}', now());
     INSERT INTO vetchium.org_domains (domain, org_did)
     VALUES ('${domain}', '${did}')`,
  );
  try {
    await withProvider(request, async ({ api, owner }) => {
      const response = await api.getListing(owner, {
        domain,
        capability: "sourcing",
      });
      await expectProblem(response, 503, problems.unavailable);
    });
  } finally {
    globalSQLScalar(
      `DELETE FROM vetchium.org_domains WHERE org_did = '${did}';
       DELETE FROM vetchium.org_principals WHERE org_did = '${did}'`,
    );
  }
});

test("a provider's logo reaches search and detail only when its plan allows one", async ({
  request,
}) => {
  const token = unique();
  await withProvider(
    request,
    async (provider) => {
      const upload = await provider.api.uploadLogo(
        provider.owner,
        "image/png",
        makePNG(200, 200),
      );
      expect(upload.status(), await upload.text()).toBe(204);
      await published(provider.api, provider.owner, listing("sourcing", "S"));
      const found = await search(provider.api, provider.owner, {
        capability: "sourcing",
        query: token,
      });
      const logo = found.listings[0]?.provider.logo_url;
      expect(logo).toMatch(/^https?:\/\//);
      const detail = (await (
        await provider.api.getListing(provider.owner, {
          domain: provider.org.domain,
          capability: "sourcing",
        })
      ).json()) as ListingDetail;
      expect(detail.provider.logo_url).toMatch(/^https?:\/\//);
      expect(logo).toBeTruthy();
    },
    { name: `${token} Logo` },
  );
});

test("the mesh relay and peer listener serve Listings without private data", async ({
  request,
  apiCoverage,
}) => {
  const token = unique();
  await withProvider(
    request,
    async (sgp) => {
      await withProvider(
        request,
        async (deu) => {
          await published(sgp.api, sgp.owner, listing("sourcing", "Sgp"));
          await published(deu.api, deu.owner, listing("sourcing", "Deu"));
          const body = (limit = 5) => ({
            capability: "sourcing",
            query: token,
            limit,
          });
          const relay = (
            path: string,
            payload: unknown,
            auth?: string | null,
          ) =>
            meshRelayRequest(
              "sgp",
              path,
              payload,
              apiCoverage,
              auth === undefined ? {} : { authorization: auth },
            );

          const local = relay("/mesh/listings/search", {
            tenant: "sgp",
            search: body(),
          });
          expect(local.status, JSON.stringify(local.body)).toBe(200);
          expect(local.body).toMatchObject({
            listings: [
              {
                sort_name: `${token} sgp`,
                listing: { provider: { domain: sgp.org.domain } },
              },
            ],
            has_more: false,
          });
          const remote = relay("/mesh/listings/search", {
            tenant: "deu",
            search: body(),
          });
          expect(remote.status, JSON.stringify(remote.body)).toBe(200);
          expect(remote.body).toMatchObject({
            listings: [{ listing: { provider: { domain: deu.org.domain } } }],
          });
          const paged = relay("/mesh/listings/search", {
            tenant: "sgp",
            search: { ...body(1), after: { sort_name: "", domain: "a.test" } },
          });
          expect(paged.status).toBe(400);
          const resumed = relay("/mesh/listings/search", {
            tenant: "sgp",
            search: {
              ...body(1),
              after: { sort_name: `${token} sgp`, domain: sgp.org.domain },
            },
          });
          expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
          expect(resumed.body).toMatchObject({ listings: [], has_more: false });

          const detail = relay("/mesh/listings/get", {
            tenant: "deu",
            listing: { domain: deu.org.domain, capability: "sourcing" },
          });
          expect(detail.status, JSON.stringify(detail.body)).toBe(200);
          expect(detail.body).toMatchObject({
            provider: { domain: deu.org.domain },
            description: "We run **structured** interviews.",
          });
          const missing = relay("/mesh/listings/get", {
            tenant: "sgp",
            listing: { domain: deu.org.domain, capability: "sourcing" },
          });
          expect(missing.status).toBe(404);
          expect(missing.body).toMatchObject({ type: problems.notFound });

          const gone = relay("/mesh/listings/search", {
            tenant: "gone",
            search: body(),
          });
          expect(gone.status, JSON.stringify(gone.body)).toBe(503);
          expect(gone.body).toMatchObject({ type: problems.unavailable });
          const goneGet = relay("/mesh/listings/get", {
            tenant: "gone",
            listing: { domain: deu.org.domain, capability: "sourcing" },
          });
          expect(goneGet.status).toBe(503);
          expect(goneGet.body).toMatchObject({ type: problems.unavailable });

          expect(
            relay(
              "/mesh/listings/search",
              { tenant: "sgp", search: body() },
              null,
            ).status,
          ).toBe(401);
          expect(
            relay("/mesh/listings/get", { tenant: "sgp" }, "wrong").status,
          ).toBe(401);
          expect(
            relay("/mesh/listings/search", {
              tenant: "Bad Tenant",
              search: body(0),
            }).status,
          ).toBe(400);
          expect(
            relay("/mesh/listings/get", {
              tenant: "sgp",
              listing: { domain: "x", capability: "sourcing" },
            }).status,
          ).toBe(400);
          expect(
            meshRelayRequest("sgp", "/mesh/listings/search", {}, apiCoverage, {
              rawBody: "{",
            }).status,
          ).toBe(400);

          for (const path of [
            "/api/mesh/listings/search",
            "/api/mesh/listings/get",
          ]) {
            const malformed = meshPeerRequest("sgp", "deu", {}, apiCoverage, {
              path,
              rawBody: "{",
            });
            expect(malformed.status, JSON.stringify(malformed.body)).toBe(400);
            expect(malformed.body).toMatchObject({
              type: problems.invalidJSON,
            });
          }
          const malformedGet = meshRelayRequest(
            "sgp",
            "/mesh/listings/get",
            {},
            apiCoverage,
            { rawBody: "{" },
          );
          expect(malformedGet.status).toBe(400);
          expect(malformedGet.body).toMatchObject({
            type: problems.invalidJSON,
          });
          const peer = meshPeerRequest("sgp", "deu", body(), apiCoverage, {
            path: "/api/mesh/listings/search",
          });
          expect(peer.status, JSON.stringify(peer.body)).toBe(200);
          expect(peer.body).toMatchObject({
            listings: [{ listing: { provider: { domain: deu.org.domain } } }],
          });
          const peerGet = meshPeerRequest(
            "sgp",
            "deu",
            { domain: deu.org.domain, capability: "sourcing" },
            apiCoverage,
            { path: "/api/mesh/listings/get" },
          );
          expect(peerGet.status, JSON.stringify(peerGet.body)).toBe(200);
          const peerMissing = meshPeerRequest(
            "sgp",
            "deu",
            { domain: sgp.org.domain, capability: "sourcing" },
            apiCoverage,
            { path: "/api/mesh/listings/get" },
          );
          expect(peerMissing.status).toBe(404);
          expect(peerMissing.body).toMatchObject({ type: problems.notFound });
          expect(
            meshPeerRequest("sgp", "deu", { limit: 0 }, apiCoverage, {
              path: "/api/mesh/listings/search",
            }).status,
          ).toBe(400);
          const peerInvalid = meshPeerRequest(
            "sgp",
            "deu",
            { domain: "x", capability: "sourcing" },
            apiCoverage,
            { path: "/api/mesh/listings/get" },
          );
          expect(peerInvalid.status).toBe(400);
          expect(peerInvalid.body).toMatchObject({ type: problems.validation });
          for (const path of [
            "/api/mesh/listings/search",
            "/api/mesh/listings/get",
          ]) {
            // The handshake fails before any HTTP status exists.
            expect(
              meshPeerRequest("sgp", "deu", body(), [], {
                path,
                withoutCertificate: true,
              }).status,
            ).toBe(0);
            const health = meshPeerRequest("sgp", "deu", body(), apiCoverage, {
              path,
              certificate: "health",
            });
            expect(health.status, JSON.stringify(health.body)).toBe(401);
            expect(health.body).toMatchObject({
              type: `${base}mesh-peer-authentication-required`,
            });
          }
          for (const value of [
            local.body,
            remote.body,
            detail.body,
            peer.body,
          ]) {
            expect(JSON.stringify(value)).not.toMatch(
              /org_did|email|version|"state"|session|credential|password/,
            );
            expect(JSON.stringify(value)).not.toMatch(moneyKey);
          }
        },
        { tenant: "deu", name: `${token} Deu` },
      );
    },
    { name: `${token} Sgp` },
  );
});

test("one Org's Listing writes never touch another Org's Listings", async ({
  request,
}) => {
  await withProvider(request, async (first) => {
    await withProvider(request, async (second) => {
      const theirs = await created(first.api, first.owner, listing("sourcing"));
      const mine = await created(second.api, second.owner, listing("sourcing"));
      expect(mine.version).toBe(1);
      const response = await second.api.publishListing(second.owner, {
        capability: "sourcing",
        version: mine.version,
      });
      expect(response.status(), await response.text()).toBe(200);
      const unchanged = (await (
        await first.api.listListings(first.owner)
      ).json()) as { listings: Listing[] };
      expect(unchanged.listings).toEqual([theirs]);
    });
  });
});
