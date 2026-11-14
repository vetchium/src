import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type {
  SearchOpeningsRequest,
  SearchOpeningsResponse,
  SuggestOpeningOrgsRequest,
  SuggestOpeningOrgsResponse,
} from "typespec/hub/openings/search";
import type { OrgOpening } from "typespec/orgs/openings/types";
import {
  cleanupHubUser,
  seedActiveHubUser,
  type TestTenant,
} from "../lib/admin-db.ts";
import { test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import { HubAPI } from "../lib/hub-api.ts";
import {
  type MeshResponse,
  meshPeerRequest,
  meshRelayRequest,
} from "../lib/mesh.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgSQL,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";

const problemBase = "vetchium-problem-details/";
// A well-formed tenant id that no region catalog names and no peer answers.
const unknownRegion = "gone";

interface TestOrg {
  api: OrgsAPI;
  org: SignedUpOrg;
  owner: string;
}

/** A token no other test puts in a title or Org name. */
function token(): string {
  return `t${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function content(
  title: string,
  overrides: OpeningContent = {},
): OpeningContent {
  return {
    title,
    description: "Build reliable services",
    language: "en",
    employing_country: "SG",
    work_arrangement: "hybrid",
    employment_type: "full_time",
    positions: 1,
    ...overrides,
  };
}

async function createOrg(
  request: APIRequestContext,
  tenant: TestTenant,
  created: TestOrg[],
): Promise<TestOrg> {
  const api = new OrgsAPI(request, tenant);
  const org = await signupOrg(api);
  const entry: TestOrg = { api, org, owner: "" };
  created.push(entry);
  entry.owner = await loginOrg(api, org);
  return entry;
}

async function draftOpening(
  { api, org, owner }: TestOrg,
  opening: OpeningContent,
): Promise<OrgOpening> {
  const response = await api.createOpening(owner, {
    content: opening,
    hiring_manager_email: org.emailAddress,
    recruiter_email: org.emailAddress,
    team_member_emails: [],
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as OrgOpening;
}

async function changeOpening(
  { api, owner }: TestOrg,
  opening: OrgOpening,
  kind: "publish" | "pause" | "close",
): Promise<OrgOpening> {
  const response = await api.requestOpeningChange(owner, {
    opening_number: opening.opening_number,
    version: opening.version,
    kind,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as OrgOpening;
}

async function publishOpening(
  org: TestOrg,
  opening: OpeningContent,
): Promise<OrgOpening> {
  return changeOpening(org, await draftOpening(org, opening), "publish");
}

function orgWhere(org: TestOrg): string {
  return `org_did = (SELECT org_did FROM vetchium.org_domains
    WHERE domain = '${org.org.domain}')`;
}

/** Moves first publication back, keeping the expiry and creation rules. */
function publishedAgo(org: TestOrg, numbers: number[], interval: string) {
  orgSQL(
    `UPDATE vetchium.org_openings SET
      created_at = now() - interval '${interval}' - interval '1 minute',
      first_published_at = now() - interval '${interval}',
      expires_at = now() - interval '${interval}' + interval '180 days'
    WHERE ${orgWhere(org)} AND opening_number IN (${numbers.join(", ")})`,
    org.api.tenant,
  );
}

function setDisplayName(org: TestOrg, name: string) {
  orgSQL(
    `UPDATE vetchium.orgs SET display_name = '${name}' WHERE ${orgWhere(org)}`,
    org.api.tenant,
  );
}

async function cleanupOrgs(orgs: TestOrg[]) {
  for (const { api, org } of orgs) {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain, api.tenant);
  }
}

function viewerEmail(): string {
  return `e2e+${randomUUID()}@e2e-${randomUUID()}.example.test`;
}

const orgKeys = ["country", "display_name", "domain"];
const openingKeys = [
  "employing_country",
  "employment_type",
  "first_published_at",
  "opening_number",
  "tags",
  "title",
  "work_arrangement",
];

/** Every result carries exactly the public fields (OPN-SRCH-006). */
function expectPublicResults(body: SearchOpeningsResponse) {
  for (const result of body.openings) {
    expect(Object.keys(result).sort()).toEqual(["opening", "org"]);
    expectPublicOrg(result.org);
    const keys = Object.keys(result.opening).sort();
    expect(keys).toEqual(
      result.opening.salary === undefined
        ? openingKeys
        : [...openingKeys, "salary"].sort(),
    );
    if (result.opening.salary !== undefined) {
      expect(Object.keys(result.opening.salary).sort()).toEqual([
        "currency",
        "max",
        "min",
        "period",
      ]);
    }
  }
}

function expectPublicOrg(org: object) {
  const keys = Object.keys(org).sort();
  expect(keys).toEqual(
    "logo_url" in org ? [...orgKeys, "logo_url"].sort() : orgKeys,
  );
}

async function search(
  hub: HubAPI,
  token: string,
  body: SearchOpeningsRequest,
): Promise<SearchOpeningsResponse> {
  const response = await hub.searchOpenings(body, token);
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const parsed = (await response.json()) as SearchOpeningsResponse;
  expectPublicResults(parsed);
  return parsed;
}

async function suggest(
  hub: HubAPI,
  token: string,
  body: SuggestOpeningOrgsRequest,
): Promise<SuggestOpeningOrgsResponse> {
  const response = await hub.suggestOpeningOrgs(body, token);
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const parsed = (await response.json()) as SuggestOpeningOrgsResponse;
  for (const org of parsed.orgs) expectPublicOrg(org);
  return parsed;
}

function numbers(body: SearchOpeningsResponse): number[] {
  return body.openings.map(({ opening }) => opening.opening_number);
}

function expectMeshProblem(
  response: MeshResponse,
  status: number,
  type: string,
) {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(response.body).toMatchObject({ status, type: problemBase + type });
}

test("search-openings applies every filter on both sides of its boundary", async ({
  request,
}) => {
  const email = viewerEmail();
  const created: TestOrg[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    const { sessionToken } = seedActiveHubUser("sgp", email, "Searcher");
    const word = token();
    const orgWord = token();
    const org = await createOrg(request, "sgp", created);
    setDisplayName(org, `Zephyr ${orgWord}`);
    const onSite = await publishOpening(
      org,
      content(`On-site ${word}`, {
        work_arrangement: "on_site",
        employment_type: "full_time",
        experience_years: { min: 2, max: 5 },
        minimum_education: "bachelor",
        salary: { currency: "SGD", min: 5000, max: 8000, period: "month" },
        tags: ["golang", "rust"],
      }),
    );
    const hybrid = await publishOpening(
      org,
      content(`Hybrid ${word}`, {
        employing_country: "IN",
        employment_type: "part_time",
        tags: ["golang"],
      }),
    );
    const worldwide = await publishOpening(
      org,
      content(`Worldwide ${word}`, {
        work_arrangement: "remote",
        remote_eligibility: { kind: "worldwide" },
        employment_type: "contract",
        experience_years: { min: 3 },
        minimum_education: "master",
      }),
    );
    const countries = await publishOpening(
      org,
      content(`Countries ${word}`, {
        employing_country: "DE",
        work_arrangement: "remote",
        remote_eligibility: { kind: "countries", countries: ["DE", "AT"] },
        employment_type: "internship",
        experience_years: { max: 1 },
        minimum_education: "doctorate",
      }),
    );
    publishedAgo(org, [worldwide.opening_number], "2 days");
    publishedAgo(org, [countries.opening_number], "10 days");
    const [o1, o2, o3, o4] = [onSite, hybrid, worldwide, countries].map(
      ({ opening_number }) => opening_number,
    );
    const all = [o2, o1, o3, o4];
    const find = async (filters: SearchOpeningsRequest) =>
      numbers(await search(hub, sessionToken, { keyword: word, ...filters }));

    expect(await find({})).toEqual(all);
    expect(await find({ keyword: word.toUpperCase() })).toEqual(all);
    expect(
      numbers(await search(hub, sessionToken, { keyword: orgWord })),
    ).toEqual(all);
    expect(
      numbers(await search(hub, sessionToken, { keyword: token() })),
    ).toEqual([]);

    expect(
      numbers(await search(hub, sessionToken, { org_domain: org.org.domain })),
    ).toEqual(all);
    expect(
      await find({ org_domain: `missing-${randomUUID()}.example.com` }),
    ).toEqual([]);

    expect(await find({ tag_oids: ["golang"] })).toEqual([o2, o1]);
    expect(await find({ tag_oids: ["golang", "rust"] })).toEqual([o1, o2]);
    expect(await find({ tag_oids: ["rust"] })).toEqual([o1]);
    expect(await find({ tag_oids: ["no-such-tag"] })).toEqual([]);

    expect(await find({ work_countries: ["SG"] })).toEqual([o1, o3]);
    expect(await find({ work_countries: ["IN"] })).toEqual([o2, o3]);
    expect(await find({ work_countries: ["AT"] })).toEqual([o3, o4]);
    expect(await find({ work_countries: ["de", "IN"] })).toEqual([o2, o3, o4]);
    expect(await find({ work_countries: ["FR"] })).toEqual([o3]);

    expect(await find({ work_arrangements: ["on_site"] })).toEqual([o1]);
    expect(await find({ work_arrangements: ["hybrid", "on_site"] })).toEqual([
      o2,
      o1,
    ]);
    expect(await find({ work_arrangements: ["remote"] })).toEqual([o3, o4]);

    expect(await find({ employment_types: ["full_time"] })).toEqual([o1]);
    expect(await find({ employment_types: ["part_time"] })).toEqual([o2]);
    expect(
      await find({ employment_types: ["contract", "internship"] }),
    ).toEqual([o3, o4]);

    expect(await find({ posted_within_days: 1 })).toEqual([o2, o1]);
    expect(await find({ posted_within_days: 7 })).toEqual([o2, o1, o3]);
    expect(await find({ posted_within_days: 30 })).toEqual(all);

    expect(await find({ experience_years: 0 })).toEqual([o2, o4]);
    expect(await find({ experience_years: 1 })).toEqual([o2, o4]);
    expect(await find({ experience_years: 2 })).toEqual([o2, o1]);
    expect(await find({ experience_years: 5 })).toEqual([o2, o1, o3]);
    expect(await find({ experience_years: 6 })).toEqual([o2, o3]);

    expect(await find({ education_level: "secondary" })).toEqual([o2]);
    expect(await find({ education_level: "bachelor" })).toEqual([o2, o1]);
    expect(await find({ education_level: "master" })).toEqual([o2, o1, o3]);
    expect(await find({ education_level: "doctorate" })).toEqual(all);

    expect(await find({ salary_disclosed: true })).toEqual([o1]);
    expect(await find({ salary_disclosed: false })).toEqual(all);

    expect(
      await find({
        tag_oids: ["golang"],
        work_countries: ["SG"],
        salary_disclosed: true,
      }),
    ).toEqual([o1]);

    const detailed = await search(hub, sessionToken, { keyword: word });
    const paid = detailed.openings.find(
      ({ opening }) => opening.opening_number === o1,
    );
    expect(paid?.org).toEqual({
      domain: org.org.domain,
      display_name: `Zephyr ${orgWord}`,
      country: "SG",
    });
    expect(paid?.opening).toEqual({
      opening_number: o1,
      title: `On-site ${word}`,
      employing_country: "SG",
      work_arrangement: "on_site",
      employment_type: "full_time",
      first_published_at: paid?.opening.first_published_at,
      tags: ["golang", "rust"],
      salary: { currency: "SGD", min: 5000, max: 8000, period: "month" },
    });
    const unpaid = detailed.openings.find(
      ({ opening }) => opening.opening_number === o2,
    );
    expect(unpaid?.opening).not.toHaveProperty("salary");
    expect(unpaid?.opening.tags).toEqual(["golang"]);
  } finally {
    await cleanupOrgs(created);
    cleanupHubUser(email, "sgp");
  }
});

test("search-openings orders by publication, domain, and number and binds its pagination key", async ({
  request,
}) => {
  const email = viewerEmail();
  const created: TestOrg[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    const { sessionToken } = seedActiveHubUser("sgp", email, "Pager");
    const word = token();
    const first = await createOrg(request, "sgp", created);
    const second = await createOrg(request, "sgp", created);
    const opened: { org: TestOrg; number: number }[] = [];
    for (const org of [first, second]) {
      for (const title of ["One", "Two"]) {
        const opening = await publishOpening(org, content(`${title} ${word}`));
        opened.push({ org, number: opening.opening_number });
      }
    }
    // One statement gives all four the same first publication instant, so
    // only the domain and number break the tie.
    orgSQL(
      `UPDATE vetchium.org_openings SET
        created_at = now() - interval '1 hour 1 minute',
        first_published_at = now() - interval '1 hour',
        expires_at = now() - interval '1 hour' + interval '180 days'
      WHERE org_did IN (SELECT org_did FROM vetchium.org_domains
        WHERE domain IN ('${first.org.domain}', '${second.org.domain}'))`,
      "sgp",
    );
    const newest = await publishOpening(first, content(`Newest ${word}`));
    const key = (domain: string, number: number) => `${domain}#${number}`;
    const tied = opened
      .map(({ org, number }) => ({ domain: org.org.domain, number }))
      .sort((a, b) =>
        a.domain === b.domain
          ? b.number - a.number
          : a.domain < b.domain
            ? -1
            : 1,
      )
      .map(({ domain, number }) => key(domain, number));
    const expected = [key(first.org.domain, newest.opening_number), ...tied];

    const everything = await search(hub, sessionToken, { keyword: word });
    expect(
      everything.openings.map(({ org, opening }) =>
        key(org.domain, opening.opening_number),
      ),
    ).toEqual(expected);
    expect(everything.next_pagination_key).toBeUndefined();

    const pages: string[] = [];
    let paginationKey: string | undefined;
    let firstKey: string | undefined;
    do {
      const page = await search(hub, sessionToken, {
        keyword: word,
        limit: 2,
        ...(paginationKey === undefined
          ? {}
          : { pagination_key: paginationKey }),
      });
      expect(page.openings.length).toBeLessThanOrEqual(2);
      pages.push(
        ...page.openings.map(({ org, opening }) =>
          key(org.domain, opening.opening_number),
        ),
      );
      paginationKey = page.next_pagination_key;
      firstKey ??= paginationKey;
    } while (paginationKey !== undefined);
    expect(pages).toEqual(expected);
    if (firstKey === undefined) throw new Error("missing pagination key");

    for (const changed of [
      { keyword: `${word}x` },
      { keyword: word, salary_disclosed: true },
      { keyword: word, tag_oids: ["golang"] },
      { keyword: word, region: "usa1" },
    ] satisfies SearchOpeningsRequest[]) {
      const response = await hub.searchOpenings(
        { ...changed, limit: 2, pagination_key: firstKey },
        sessionToken,
      );
      expect(response.status(), await response.text()).toBe(400);
      expect(await response.json()).toMatchObject({
        type: `${problemBase}invalid-pagination-key`,
      });
    }
    const sameFilters = await search(hub, sessionToken, {
      keyword: word.toUpperCase(),
      limit: 2,
      pagination_key: firstKey,
    });
    expect(sameFilters.openings.length).toBe(2);
  } finally {
    await cleanupOrgs(created);
    cleanupHubUser(email, "sgp");
  }
});

test("search-openings excludes drafts, paused, closed, and expired Openings, suspended Orgs, and released domains", async ({
  request,
}) => {
  const email = viewerEmail();
  const created: TestOrg[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    const { sessionToken } = seedActiveHubUser("sgp", email, "Excluder");
    const word = token();
    const org = await createOrg(request, "sgp", created);
    const live = await publishOpening(org, content(`Live ${word}`));
    await draftOpening(org, content(`Draft ${word}`));
    await changeOpening(
      org,
      await publishOpening(org, content(`Paused ${word}`)),
      "pause",
    );
    await changeOpening(
      org,
      await publishOpening(org, content(`Closed ${word}`)),
      "close",
    );
    const expired = await publishOpening(org, content(`Expired ${word}`));
    orgSQL(
      `UPDATE vetchium.org_openings SET opening_state = 'expired',
        created_at = now() - interval '181 days',
        first_published_at = now() - interval '180 days 1 minute',
        expires_at = now() - interval '1 minute', ended_at = now()
      WHERE ${orgWhere(org)} AND opening_number = ${expired.opening_number}`,
    );
    const lapsed = await publishOpening(org, content(`Lapsed ${word}`));
    // Published, but past its expiry before the worker has run.
    orgSQL(
      `UPDATE vetchium.org_openings SET
        created_at = now() - interval '181 days',
        first_published_at = now() - interval '180 days 1 minute',
        expires_at = now() - interval '1 minute'
      WHERE ${orgWhere(org)} AND opening_number = ${lapsed.opening_number}`,
    );
    const suspended = await createOrg(request, "sgp", created);
    await publishOpening(suspended, content(`Suspended ${word}`));
    const released = await createOrg(request, "sgp", created);
    await publishOpening(released, content(`Released ${word}`));
    expect(
      (await search(hub, sessionToken, { keyword: word })).openings.length,
    ).toBe(3);
    for (const visible of [suspended, released]) {
      expect(
        (await suggest(hub, sessionToken, { query: visible.org.domain })).orgs,
      ).toHaveLength(1);
    }

    orgSQL(
      `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
      WHERE ${orgWhere(suspended)}`,
    );
    orgSQL(
      `UPDATE vetchium.org_domains SET domain_state = 'released',
        released_at = now() WHERE domain = '${released.org.domain}'`,
    );
    const body = await search(hub, sessionToken, { keyword: word });
    expect(
      body.openings.map(({ org: { domain }, opening }) => ({
        domain,
        title: opening.title,
      })),
    ).toEqual([{ domain: org.org.domain, title: `Live ${word}` }]);
    expect(numbers(body)).toEqual([live.opening_number]);
    for (const gone of [suspended, released]) {
      expect(
        (await search(hub, sessionToken, { org_domain: gone.org.domain }))
          .openings,
      ).toEqual([]);
      expect(
        (await suggest(hub, sessionToken, { query: gone.org.domain })).orgs,
      ).toEqual([]);
    }
  } finally {
    await cleanupOrgs(created);
    cleanupHubUser(email, "sgp");
  }
});

test("suggest-opening-orgs matches names and domain prefixes, caps at ten, and skips Orgs without an Opening", async ({
  request,
}) => {
  test.setTimeout(60_000);
  const email = viewerEmail();
  const created: TestOrg[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    const { sessionToken } = seedActiveHubUser("sgp", email, "Suggester");
    const word = token();
    const orgs = await Promise.all(
      Array.from({ length: 11 }, async (_, index) => {
        const org = await createOrg(request, "sgp", created);
        await publishOpening(org, content("Engineer"));
        setDisplayName(org, `${String.fromCharCode(75 - index)} ${word} Co`);
        return org;
      }),
    );
    const quiet = await createOrg(request, "sgp", created);
    await draftOpening(quiet, content("Unpublished"));
    setDisplayName(quiet, `A ${word} Quiet`);
    const closed = await createOrg(request, "sgp", created);
    await changeOpening(
      closed,
      await publishOpening(closed, content("Closed")),
      "close",
    );
    setDisplayName(closed, `B ${word} Closed`);

    const byName = await suggest(hub, sessionToken, {
      query: word.toUpperCase(),
    });
    // Display names run K down to A; ordering is by lower-cased name.
    const expected = orgs
      .map(({ org }, index) => ({
        domain: org.domain,
        display_name: `${String.fromCharCode(75 - index)} ${word} Co`,
        country: "SG",
      }))
      .reverse();
    expect(byName.orgs).toEqual(expected.slice(0, 10));

    const target = orgs[3];
    if (target === undefined) throw new Error("missing Org");
    const prefix = target.org.domain.slice(0, 14);
    const byDomain = await suggest(hub, sessionToken, { query: prefix });
    expect(byDomain.orgs.map(({ domain }) => domain)).toEqual([
      target.org.domain,
    ]);
    const inner = target.org.domain.slice(4, 14);
    expect((await suggest(hub, sessionToken, { query: inner })).orgs).toEqual(
      [],
    );
    expect(
      (await suggest(hub, sessionToken, { query: quiet.org.domain })).orgs,
    ).toEqual([]);
    expect(
      (await suggest(hub, sessionToken, { query: closed.org.domain })).orgs,
    ).toEqual([]);
    expect(
      (await suggest(hub, sessionToken, { query: `${word}_%` })).orgs,
    ).toEqual([]);
    expect(
      (await suggest(hub, sessionToken, { query: token(), region: "sgp" }))
        .orgs,
    ).toEqual([]);
  } finally {
    await cleanupOrgs(created);
    cleanupHubUser(email, "sgp");
  }
});

test("search-openings and suggest-opening-orgs read another region through the mesh and fail closed", async ({
  request,
  apiCoverage,
}) => {
  const email = viewerEmail();
  const created: TestOrg[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    const { sessionToken } = seedActiveHubUser("sgp", email, "Traveller");
    const word = token();
    const remote = await createOrg(request, "usa1", created);
    setDisplayName(remote, `Remote ${word}`);
    const opening = await publishOpening(
      remote,
      content(`Remote ${word}`, {
        employing_country: "US",
        salary: { currency: "USD", min: 90000, max: 120000, period: "year" },
        tags: ["golang"],
      }),
    );

    const local = await search(hub, sessionToken, { keyword: word });
    expect(local.openings).toEqual([]);
    expect(
      (await search(hub, sessionToken, { keyword: word, region: "sgp" }))
        .openings,
    ).toEqual([]);
    const found = await search(hub, sessionToken, {
      keyword: word,
      region: "usa1",
      tag_oids: ["golang"],
      work_countries: ["US"],
      salary_disclosed: true,
    });
    expect(found.openings).toEqual([
      {
        org: {
          domain: remote.org.domain,
          display_name: `Remote ${word}`,
          country: "SG",
        },
        opening: {
          opening_number: opening.opening_number,
          title: `Remote ${word}`,
          employing_country: "US",
          work_arrangement: "hybrid",
          employment_type: "full_time",
          first_published_at: found.openings[0]?.opening.first_published_at,
          tags: ["golang"],
          salary: {
            currency: "USD",
            min: 90000,
            max: 120000,
            period: "year",
          },
        },
      },
    ]);
    const second = await publishOpening(remote, content(`Second ${word}`));
    const firstPage = await search(hub, sessionToken, {
      keyword: word,
      region: "usa1",
      limit: 1,
    });
    expect(numbers(firstPage)).toEqual([second.opening_number]);
    const remoteKey = firstPage.next_pagination_key;
    if (remoteKey === undefined) throw new Error("missing pagination key");
    expect(
      numbers(
        await search(hub, sessionToken, {
          keyword: word,
          region: "usa1",
          limit: 1,
          pagination_key: remoteKey,
        }),
      ),
    ).toEqual([opening.opening_number]);
    const otherTenant = await hub.searchOpenings(
      { keyword: word, limit: 1, pagination_key: remoteKey },
      sessionToken,
    );
    expect(otherTenant.status(), await otherTenant.text()).toBe(400);
    expect(await otherTenant.json()).toMatchObject({
      type: `${problemBase}invalid-pagination-key`,
    });

    expect(
      (await suggest(hub, sessionToken, { query: word, region: "usa1" })).orgs,
    ).toEqual([
      {
        domain: remote.org.domain,
        display_name: `Remote ${word}`,
        country: "SG",
      },
    ]);
    expect((await suggest(hub, sessionToken, { query: word })).orgs).toEqual(
      [],
    );

    for (const call of [
      () =>
        hub.searchOpenings(
          { keyword: word, region: unknownRegion },
          sessionToken,
        ),
      () =>
        hub.suggestOpeningOrgs(
          { query: word, region: unknownRegion },
          sessionToken,
        ),
    ]) {
      const response = await call();
      expect(response.status(), await response.text()).toBe(503);
      expect(await response.json()).toEqual({
        type: `${problemBase}hub-region-unavailable`,
        title: "Region unavailable",
        status: 503,
        detail: "The requested region is temporarily unavailable",
      });
    }

    const relay = meshRelayRequest(
      "sgp",
      "/mesh/opening-search/search",
      { tenant_id: "usa1", query: { keyword: word } },
      apiCoverage,
    );
    expect(relay.status, JSON.stringify(relay.body)).toBe(200);
    expectPublicResults(relay.body as SearchOpeningsResponse);
    expect((relay.body as SearchOpeningsResponse).openings.length).toBe(2);
    const peer = meshPeerRequest(
      "sgp",
      "usa1",
      { keyword: word },
      apiCoverage,
      { path: "/api/mesh/opening-search/search" },
    );
    expect(peer.status, JSON.stringify(peer.body)).toBe(200);
    expectPublicResults(peer.body as SearchOpeningsResponse);
    for (const body of [relay.body, peer.body, found]) {
      expect(JSON.stringify(body)).not.toMatch(
        /org_did|hiring_manager|recruiter|internal_notes|version|email|description|matched_tags|logo_object_id/,
      );
    }
    const peerSuggest = meshPeerRequest(
      "sgp",
      "usa1",
      { query: word },
      apiCoverage,
      { path: "/api/mesh/opening-search/suggest-orgs" },
    );
    expect(peerSuggest.status, JSON.stringify(peerSuggest.body)).toBe(200);
    expect((peerSuggest.body as SuggestOpeningOrgsResponse).orgs).toEqual([
      {
        domain: remote.org.domain,
        display_name: `Remote ${word}`,
        country: "SG",
      },
    ]);
    const relaySuggest = meshRelayRequest(
      "sgp",
      "/mesh/opening-search/suggest-orgs",
      { tenant_id: "usa1", query: { query: word } },
      apiCoverage,
    );
    expect(relaySuggest.status, JSON.stringify(relaySuggest.body)).toBe(200);
    expect((relaySuggest.body as SuggestOpeningOrgsResponse).orgs).toHaveLength(
      1,
    );
  } finally {
    await cleanupOrgs(created);
    cleanupHubUser(email, "sgp");
  }
});

test("search-openings and suggest-opening-orgs reject malformed, invalid, and unauthenticated requests", async ({
  request,
}) => {
  const email = viewerEmail();
  const hub = new HubAPI(request, "sgp");
  try {
    const { sessionToken } = seedActiveHubUser("sgp", email, "Validator");
    const cases: [string, unknown, string[]][] = [
      [
        "/search-openings",
        {
          keyword: "g",
          org_domain: "not a domain",
          tag_oids: ["Go Lang", "golang", "golang"],
          work_countries: ["SG", "sg", "XX"],
          work_arrangements: ["remote", "remote", "office"],
          employment_types: ["gig"],
          posted_within_days: 2,
          experience_years: 51,
          education_level: "diploma",
          pagination_key: "",
          limit: 51,
          region: "USA 1",
        },
        [
          "keyword",
          "org_domain",
          "tag_oids.0",
          "tag_oids.2",
          "work_countries.1",
          "work_countries.2",
          "work_arrangements.1",
          "work_arrangements.2",
          "employment_types.0",
          "posted_within_days",
          "experience_years",
          "education_level",
          "pagination_key",
          "limit",
          "region",
        ],
      ],
      [
        "/search-openings",
        {
          keyword: "x".repeat(201),
          tag_oids: ["a1", "b1", "c1", "d1", "e1", "f1"],
          work_countries: [
            "DE",
            "FR",
            "GB",
            "IN",
            "SG",
            "US",
            "JP",
            "CA",
            "AU",
            "NL",
            "BE",
          ],
          work_arrangements: [],
          employment_types: [],
          experience_years: -1,
          limit: 0,
        },
        [
          "keyword",
          "tag_oids",
          "work_countries",
          "work_arrangements",
          "employment_types",
          "experience_years",
          "limit",
        ],
      ],
      ["/suggest-opening-orgs", { query: " a " }, ["query"]],
      [
        "/suggest-opening-orgs",
        { query: "x".repeat(101), region: "X" },
        ["query", "region"],
      ],
      ["/suggest-opening-orgs", {}, ["query"]],
    ];
    for (const [path, body, fields] of cases) {
      const response = await hub.post(path, body, { token: sessionToken });
      expect(response.status(), await response.text()).toBe(400);
      expect(await response.json()).toMatchObject({
        type: `${problemBase}validation-failed`,
        fields,
      });
    }
    for (const path of ["/search-openings", "/suggest-opening-orgs"]) {
      for (const raw of ["{", '{"unknown":1}', '{"limit":"20"}']) {
        const response = await hub.postRaw(path, raw, { token: sessionToken });
        expect(response.status(), `${path} ${raw}`).toBe(400);
        expect(await response.json()).toMatchObject({
          type: `${problemBase}invalid-json`,
        });
      }
      const signedOut = await hub.post(path, { query: "ab" });
      expect(signedOut.status()).toBe(401);
      expect(signedOut.headers()["www-authenticate"]).toContain("Bearer");
      expect(await signedOut.json()).toMatchObject({
        type: `${problemBase}hub-authentication-required`,
      });
    }
    const badKey = await hub.searchOpenings(
      { pagination_key: "bm90LWEta2V5" },
      sessionToken,
    );
    expect(badKey.status(), await badKey.text()).toBe(400);
    expect(await badKey.json()).toMatchObject({
      type: `${problemBase}invalid-pagination-key`,
    });
  } finally {
    cleanupHubUser(email, "sgp");
  }
});

test("mesh Opening search routes enforce credentials, validation, and the answering tenant", async ({
  apiCoverage,
}) => {
  for (const [path, valid, invalid, fields] of [
    [
      "/mesh/opening-search/search",
      { tenant_id: "sgp", query: { limit: 1 } },
      { tenant_id: "Bad", query: { keyword: "g", limit: 0 } },
      ["tenant_id", "query.keyword", "query.limit"],
    ],
    [
      "/mesh/opening-search/suggest-orgs",
      { tenant_id: "sgp", query: { query: "ab" } },
      { tenant_id: "sgp", query: { query: "a" } },
      ["query.query"],
    ],
  ] as const) {
    expectMeshProblem(
      meshRelayRequest("sgp", path, valid, apiCoverage, {
        authorization: null,
      }),
      401,
      "mesh-relay-authentication-required",
    );
    const own = meshRelayRequest("sgp", path, valid, apiCoverage);
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    const invalidResponse = meshRelayRequest("sgp", path, invalid, apiCoverage);
    expectMeshProblem(invalidResponse, 400, "validation-failed");
    expect(invalidResponse.body).toMatchObject({ fields });
    expectMeshProblem(
      meshRelayRequest("sgp", path, undefined, apiCoverage, { rawBody: "{" }),
      400,
      "invalid-json",
    );
    expectMeshProblem(
      meshRelayRequest(
        "sgp",
        path,
        { ...valid, tenant_id: unknownRegion },
        apiCoverage,
      ),
      503,
      "hub-region-unavailable",
    );
  }
  expectMeshProblem(
    meshRelayRequest(
      "sgp",
      "/mesh/opening-search/search",
      { tenant_id: "sgp", query: { pagination_key: "bm90LWEta2V5" } },
      apiCoverage,
    ),
    400,
    "invalid-pagination-key",
  );
  expectMeshProblem(
    meshRelayRequest(
      "sgp",
      "/mesh/opening-search/search",
      { tenant_id: "usa1", query: { pagination_key: "bm90LWEta2V5" } },
      apiCoverage,
    ),
    400,
    "invalid-pagination-key",
  );

  for (const [path, valid, invalid, fields] of [
    [
      "/api/mesh/opening-search/search",
      { limit: 1 },
      { keyword: "g", limit: 51 },
      ["keyword", "limit"],
    ],
    [
      "/api/mesh/opening-search/suggest-orgs",
      { query: "ab" },
      { query: "a" },
      ["query"],
    ],
  ] as const) {
    const answered = meshPeerRequest("sgp", "usa1", valid, apiCoverage, {
      path,
    });
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    const invalidResponse = meshPeerRequest(
      "sgp",
      "usa1",
      invalid,
      apiCoverage,
      { path },
    );
    expectMeshProblem(invalidResponse, 400, "validation-failed");
    expect(invalidResponse.body).toMatchObject({ fields });
    expectMeshProblem(
      meshPeerRequest("sgp", "usa1", undefined, apiCoverage, {
        path,
        rawBody: "{",
      }),
      400,
      "invalid-json",
    );
    // The handshake fails before any HTTP status exists.
    expect(
      meshPeerRequest("sgp", "usa1", valid, [], {
        path,
        withoutCertificate: true,
      }).status,
    ).toBe(0);
    expectMeshProblem(
      meshPeerRequest("sgp", "usa1", valid, apiCoverage, {
        path,
        certificate: "health",
      }),
      401,
      "mesh-peer-authentication-required",
    );
  }
  expectMeshProblem(
    meshPeerRequest(
      "sgp",
      "usa1",
      { pagination_key: "bm90LWEta2V5" },
      apiCoverage,
      { path: "/api/mesh/opening-search/search" },
    ),
    400,
    "invalid-pagination-key",
  );
});
