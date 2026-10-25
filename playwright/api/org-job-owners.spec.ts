import { randomUUID } from "node:crypto";
import type {
  JobDetail,
  JobOwnership,
  ListJobsRequest,
  ListJobsResponse,
  SuggestClientsResponse,
  SuggestJobOwnersResponse,
} from "typespec/orgs/marketplace/work/work";
import { expectProblem } from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { meshPeerRequest } from "../lib/mesh.ts";
import {
  addOrgMember,
  inviteeAddress,
  orgAuditEventsByKey,
  orgDID,
  orgSQL,
  orgsIdempotencyKey,
  orgUserID,
} from "../lib/orgs-api.ts";
import {
  activate,
  asConsumer,
  asProvider,
  type Provider,
  problems,
  propose,
} from "../lib/orgs-marketplace.ts";
import { assign, type World, withWorld } from "../lib/orgs-routing.ts";

// The agency user who looks after a Job (agent-guides/marketplace.md,
// MKT-OWN): kept in the agency's tenant, set by any agency user who can work
// on engagements, and used to list one agent's Jobs.

const owners = {
  invalid: "vetchium-problem-details/org-job-owner-invalid",
  limit: "vetchium-problem-details/org-job-owner-limit-reached",
  version: "vetchium-problem-details/org-job-owner-version-conflict",
  notFound: "vetchium-problem-details/org-engagement-work-not-found",
};

async function jobs(
  provider: Provider,
  request: ListJobsRequest = {},
): Promise<ListJobsResponse> {
  const response = await provider.api.listJobs(provider.owner, request);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as ListJobsResponse;
}

/** An active sourcing engagement assigned to the world's Opening. */
async function sourcingJob(world: World) {
  const engagement = await activate(world.pair, "sourcing");
  await asProvider(world.pair, engagement.id, engagement.version);
  await assign(world, engagement.id);
  return {
    engagement_id: engagement.id,
    opening_number: world.opening.opening_number,
  };
}

function agent(provider: Provider, label: string, permissions: string[]) {
  return addOrgMember(
    provider.api,
    provider.owner,
    provider.org.domain,
    inviteeAddress(provider.org.domain, label),
    permissions,
  );
}

test("an agency user sets, changes, and clears the owner of a Job and lists one agent's Jobs", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withWorld(request, async (world) => {
    const { provider } = world.pair;
    const job = await sourcingJob(world);
    const worker = await agent(provider, "agent", ["org:fulfil_engagements"]);

    expect((await jobs(provider)).jobs).toMatchObject([
      { engagement_id: job.engagement_id, owner_version: 0 },
    ]);
    expect((await jobs(provider)).jobs[0]?.owner).toBeUndefined();

    const key = orgsIdempotencyKey();
    const set = { ...job, owner_version: 0, owner_email: worker.emailAddress };
    const response = await provider.api.setJobOwner(provider.owner, set, key);
    expect(response.status(), await response.text()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect((await response.json()) as JobOwnership).toEqual({
      owner: worker.emailAddress,
      owner_version: 1,
    });
    const audit = orgAuditEventsByKey(key, provider.tenant);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "org.job.owner_set",
      entity_type: "org_job",
      entity_id: `${job.engagement_id}/${job.opening_number}`,
      actor_type: "org_user",
      actor_id: orgUserID(provider.org.emailAddress, provider.tenant),
      source: "orgs-api",
      payload: {
        version: 1,
        owner_org_user_id: orgUserID(worker.emailAddress, provider.tenant),
        previous_owner_org_user_id: null,
      },
    });

    // A replay answers the same and records nothing more; the key stays
    // bound to the request it first carried.
    const replay = await provider.api.setJobOwner(provider.owner, set, key);
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual({
      owner: worker.emailAddress,
      owner_version: 1,
    });
    expect(orgAuditEventsByKey(key, provider.tenant)).toHaveLength(1);
    await expectProblem(
      await provider.api.setJobOwner(
        provider.owner,
        { ...set, owner_email: provider.org.emailAddress },
        key,
      ),
      409,
      problems.keyConflict,
    );

    expect(
      (await jobs(provider, { owner_email: worker.emailAddress })).jobs,
    ).toMatchObject([
      {
        engagement_id: job.engagement_id,
        owner: worker.emailAddress,
        owner_version: 1,
      },
    ]);
    expect(
      (await jobs(provider, { owner_email: provider.org.emailAddress })).jobs,
    ).toEqual([]);
    expect(
      (
        await jobs(provider, {
          owner_email: `nobody-${randomUUID()}@example.test`,
        })
      ).jobs,
    ).toEqual([]);
    const detail = await provider.api.getJob(provider.owner, job);
    expect(detail.status(), await detail.text()).toBe(200);
    expect(((await detail.json()) as JobDetail).job).toMatchObject({
      owner: worker.emailAddress,
      owner_version: 1,
    });

    // A stale version changes nothing.
    await expectProblem(
      await provider.api.setJobOwner(provider.owner, {
        ...job,
        owner_version: 0,
        owner_email: provider.org.emailAddress,
      }),
      409,
      owners.version,
    );
    expect(
      (await jobs(provider, { owner_email: worker.emailAddress })).jobs,
    ).toHaveLength(1);

    // Any agency user may hand the Job to a colleague, then clear it.
    const moved = await provider.api.setJobOwner(worker.token, {
      ...job,
      owner_version: 1,
      owner_email: provider.org.emailAddress,
    });
    expect(moved.status(), await moved.text()).toBe(200);
    expect(await moved.json()).toEqual({
      owner: provider.org.emailAddress,
      owner_version: 2,
    });
    const clearKey = orgsIdempotencyKey();
    const cleared = await provider.api.setJobOwner(
      provider.owner,
      { ...job, owner_version: 2 },
      clearKey,
    );
    expect(cleared.status(), await cleared.text()).toBe(200);
    expect(await cleared.json()).toEqual({ owner_version: 3 });
    expect(orgAuditEventsByKey(clearKey, provider.tenant)[0]).toMatchObject({
      action: "org.job.owner_cleared",
      payload: {
        version: 3,
        owner_org_user_id: null,
        previous_owner_org_user_id: orgUserID(
          provider.org.emailAddress,
          provider.tenant,
        ),
      },
    });
    expect(
      (await jobs(provider, { owner_email: provider.org.emailAddress })).jobs,
    ).toEqual([]);
    expect((await jobs(provider)).jobs).toMatchObject([{ owner_version: 3 }]);
    expect((await jobs(provider)).jobs[0]?.owner).toBeUndefined();
    // Owners stay with the agency: the client never sees them.
    const consumerView = await asConsumer(world.pair, job.engagement_id);
    expect(JSON.stringify(consumerView)).not.toContain(worker.emailAddress);
  });
});

test("a Job owner is an active agency user who can work on engagements, within the cap", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withWorld(request, async (world) => {
    const { consumer, provider } = world.pair;
    const job = await sourcingJob(world);
    const viewer = await agent(provider, "viewer", ["org:view_openings"]);
    const leaver = await agent(provider, "leaver", ["org:fulfil_engagements"]);
    const disabled = await provider.api.disableUser(provider.owner, {
      email_address: leaver.emailAddress,
    });
    expect(disabled.status(), await disabled.text()).toBe(204);
    for (const address of [
      viewer.emailAddress,
      leaver.emailAddress,
      consumer.org.emailAddress,
      `nobody-${randomUUID()}@${provider.org.domain}`,
    ]) {
      await expectProblem(
        await provider.api.setJobOwner(provider.owner, {
          ...job,
          owner_version: 0,
          owner_email: address,
        }),
        422,
        owners.invalid,
      );
    }
    expect((await jobs(provider)).jobs).toMatchObject([{ owner_version: 0 }]);

    // Only an active sourcing engagement of this agency has Jobs.
    const interviewing = await activate(world.pair, "interviewing");
    await asProvider(world.pair, interviewing.id, interviewing.version);
    const proposed = await propose(world.pair, "assessment");
    await asProvider(world.pair, proposed.id, proposed.version);
    for (const engagement_id of [interviewing.id, proposed.id, randomUUID()]) {
      await expectProblem(
        await provider.api.setJobOwner(provider.owner, {
          engagement_id,
          opening_number: job.opening_number,
          owner_version: 0,
          owner_email: provider.org.emailAddress,
        }),
        404,
        owners.notFound,
      );
    }

    // An owner of 200 Jobs of active engagements takes no more; the Job they
    // already own does not count against them.
    const worker = await agent(provider, "busy", ["org:fulfil_engagements"]);
    orgSQL(
      `INSERT INTO vetchium.org_job_owners
         (engagement_id, opening_number, org_did, owner_org_user_id, version)
       SELECT '${job.engagement_id}', number,
         '${orgDID(provider.org.domain, provider.tenant)}',
         '${orgUserID(worker.emailAddress, provider.tenant)}', 1
       FROM generate_series(100001, 100200) AS number`,
      provider.tenant,
    );
    await expectProblem(
      await provider.api.setJobOwner(provider.owner, {
        ...job,
        owner_version: 0,
        owner_email: worker.emailAddress,
      }),
      409,
      owners.limit,
    );
    const takeOne = await provider.api.setJobOwner(provider.owner, {
      engagement_id: job.engagement_id,
      opening_number: 100001,
      owner_version: 1,
      owner_email: worker.emailAddress,
    });
    expect(takeOne.status(), await takeOne.text()).toBe(200);
  });
});

test("the Jobs list filters by title, Opening number, and employing country", async ({
  request,
  apiCoverage,
}) => {
  test.setTimeout(240_000);
  await withWorld(request, async (world) => {
    const { consumer, provider } = world.pair;
    const job = await sourcingJob(world);
    const number = String(job.opening_number);
    const country = world.opening.live_content?.employing_country ?? "SG";
    const other = country === "IN" ? "SG" : "IN";
    for (const [filter, count] of [
      [{ search: "ENGIN" }, 1],
      [{ search: "  engineer " }, 1],
      [{ search: number }, 1],
      [{ search: `${number}9` }, 0],
      [{ search: "plumber" }, 0],
      [{ employing_country: country }, 1],
      [{ employing_country: other }, 0],
    ] as const) {
      expect(
        (await jobs(provider, filter)).jobs,
        JSON.stringify(filter),
      ).toHaveLength(count);
    }
    for (const bad of [
      { search: "" },
      { search: "x".repeat(101) },
      { employing_country: "sg" },
      { owner_email: "nobody" },
    ]) {
      await expectProblem(
        await provider.api.marketplaceWriteRaw(
          "/list-jobs",
          provider.owner,
          bad,
        ),
        400,
        problems.validation,
      );
    }

    // The client's tenant takes the owner filter as the Jobs it names, and
    // refuses an empty one.
    const peer = (body: unknown) =>
      meshPeerRequest(provider.tenant, consumer.tenant, body, apiCoverage, {
        path: "/api/mesh/provider-jobs/list",
      });
    const base = {
      provider_org_did: orgDID(provider.org.domain, provider.tenant),
      state: "published",
      limit: 10,
    };
    const named = peer({ ...base, openings: [job], search: "engineer" });
    expect(named.status, JSON.stringify(named.body)).toBe(200);
    expect(named.body).toMatchObject({
      jobs: [{ job: { engagement_id: job.engagement_id } }],
    });
    expect(JSON.stringify(named.body)).not.toMatch(/owner/);
    expect(
      peer({
        ...base,
        openings: [{ ...job, opening_number: job.opening_number + 1 }],
      }).body,
    ).toEqual({ jobs: [], has_more: false });
    expect(peer({ ...base, openings: [] }).status).toBe(400);
  });
});

test("autocomplete suggests the agency's possible Job owners and the Org's clients", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withWorld(request, async (world) => {
    const { consumer, provider } = world.pair;
    const suggestOwners = async (body: object) => {
      const response = await provider.api.suggestJobOwners(
        provider.owner,
        body,
      );
      expect(response.status(), await response.text()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      return ((await response.json()) as SuggestJobOwnersResponse).owners;
    };
    const suggestClients = async (body: object) => {
      const response = await provider.api.suggestClients(provider.owner, body);
      expect(response.status(), await response.text()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      return ((await response.json()) as SuggestClientsResponse).clients;
    };

    // A proposal is not yet a client.
    const proposed = await propose(world.pair, "sourcing");
    await asProvider(world.pair, proposed.id, proposed.version);
    expect(await suggestClients({})).toEqual([]);

    const worker = await agent(provider, "agent", ["org:fulfil_engagements"]);
    const viewer = await agent(provider, "viewer", ["org:view_openings"]);
    const all = await suggestOwners({});
    expect(all).toContain(provider.org.emailAddress);
    expect(all).toContain(worker.emailAddress);
    expect(all).not.toContain(viewer.emailAddress);
    expect(await suggestOwners({ query: " AGENT " })).toEqual([
      worker.emailAddress,
    ]);
    expect(await suggestOwners({ limit: 1 })).toHaveLength(1);
    expect(await suggestOwners({ query: "zz-no-such-person" })).toEqual([]);

    const accepted = await provider.api.acceptEngagement(provider.owner, {
      engagement_id: proposed.id,
      version: proposed.version,
    });
    expect(accepted.status(), await accepted.text()).toBe(200);
    const active = await asConsumer(world.pair, proposed.id);
    await asProvider(world.pair, proposed.id, active.version);
    const client = {
      domain: consumer.org.domain,
      display_name: expect.any(String),
    };
    expect(await suggestClients({})).toEqual([client]);
    expect(await suggestClients({ capability: "sourcing" })).toEqual([client]);
    expect(await suggestClients({ capability: "assessment" })).toEqual([]);
    const part = consumer.org.domain.split(".")[0] ?? consumer.org.domain;
    expect(
      await suggestClients({ query: part.slice(2, 8).toUpperCase() }),
    ).toEqual([client]);
    expect(await suggestClients({ query: "zz-no-such-client" })).toEqual([]);
  });
});

test("Job owner endpoints authenticate, authorize, and validate", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withWorld(request, async (world) => {
    const { provider } = world.pair;
    const viewer = await agent(provider, "viewer", ["org:view_openings"]);
    const job = {
      engagement_id: randomUUID(),
      opening_number: 1,
      owner_version: 0,
    };
    const routes = [
      { path: "/set-job-owner", body: job, write: true },
      { path: "/suggest-job-owners", body: {}, write: false },
      { path: "/suggest-clients", body: {}, write: false },
    ];
    const keyed = (write: boolean) =>
      write ? { idempotencyKey: orgsIdempotencyKey() } : {};
    for (const entry of routes) {
      await expectProblem(
        await provider.api.post(entry.path, entry.body, keyed(entry.write)),
        401,
        problems.authentication,
      );
      await expectProblem(
        await provider.api.postRaw(entry.path, "{", {
          token: provider.owner,
          ...keyed(entry.write),
        }),
        400,
        problems.invalidJSON,
      );
      await expectProblem(
        await provider.api.post(entry.path, entry.body, {
          token: viewer.token,
          ...keyed(entry.write),
        }),
        403,
        problems.permission,
      );
    }
    expect(
      (
        await provider.api.post("/set-job-owner", job, {
          token: provider.owner,
        })
      ).status(),
      "set-job-owner needs an Idempotency-Key",
    ).toBe(400);
    for (const [path, bad] of [
      ["/set-job-owner", { ...job, engagement_id: "x" }],
      ["/set-job-owner", { ...job, owner_version: -1 }],
      ["/set-job-owner", { ...job, owner_email: "nobody" }],
      ["/suggest-job-owners", { limit: 21 }],
      ["/suggest-job-owners", { query: "" }],
      ["/suggest-clients", { capability: "plumbing" }],
      ["/suggest-clients", { limit: 0 }],
    ] as const) {
      await expectProblem(
        await provider.api.marketplaceWriteRaw(path, provider.owner, bad),
        400,
        problems.validation,
      );
    }
    // A suspended Org's users can only restore its domain.
    orgSQL(
      `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
       WHERE org_did = '${orgDID(provider.org.domain, provider.tenant)}'`,
      provider.tenant,
    );
    for (const entry of routes) {
      await expectProblem(
        await provider.api.post(entry.path, entry.body, {
          token: provider.owner,
          ...keyed(entry.write),
        }),
        403,
        problems.suspended,
      );
    }
  });
});
