import type { APIResponse } from "@playwright/test";
import type { Capability } from "typespec/orgs/marketplace/capabilities";
import type {
  Engagement,
  EngagementState,
  ListEngagementsResponse,
} from "typespec/orgs/marketplace/engagements";
import type { OperationStatus } from "typespec/orgs/operations/operations";
import { expectProblem } from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import {
  addOrgMember,
  inviteeAddress,
  type OrgsAPI,
  orgAuditEvents,
  orgAuditEventsByKey,
  orgDID,
  orgSQL,
  orgsIdempotencyKey,
} from "../lib/orgs-api.ts";
import {
  asConsumer,
  asProvider,
  moneyKey,
  onSilver,
  problems,
  propose,
  setOrgHome,
  withPair,
  withProvider,
} from "../lib/orgs-marketplace.ts";

const base = "vetchium-problem-details/";
const engagementProblems = {
  exists: `${base}org-engagement-exists`,
  self: `${base}org-engagement-self`,
  notFound: `${base}org-engagement-not-found`,
  state: `${base}org-engagement-state-conflict`,
  version: `${base}org-engagement-version-conflict`,
  notAvailable: `${base}org-listing-not-available`,
};

const text = (length: number) => "é".repeat(length);

test("an engagement runs from proposal to end across regions, and both sides see one state", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withPair(request, {}, async (pair) => {
    const { consumer, provider } = pair;
    const key = orgsIdempotencyKey();
    const body = {
      provider_domain: provider.org.domain,
      capability: "sourcing" as const,
      message: "  Please help us hire  ",
    };
    const response = await consumer.api.proposeEngagement(
      consumer.owner,
      body,
      key,
    );
    expect(response.status(), await response.text()).toBe(201);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const proposed = (await response.json()) as Engagement;
    expect(proposed).toMatchObject({
      version: 1,
      state: "proposed",
      capability: "sourcing",
      message: "Please help us hire",
      counterparty: {
        domain: provider.org.domain,
        display_name: "Playwright Org",
      },
    });
    expect(proposed.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      Date.parse(proposed.expires_at) - Date.parse(proposed.proposed_at),
    ).toBe(30 * 24 * 60 * 60 * 1000);
    const replay = await consumer.api.proposeEngagement(
      consumer.owner,
      body,
      key,
    );
    expect(replay.status(), await replay.text()).toBe(201);
    expect(await replay.json()).toEqual(proposed);
    expect(orgAuditEventsByKey(key)).toHaveLength(1);
    await expectProblem(
      await consumer.api.proposeEngagement(
        consumer.owner,
        { ...body, message: "Different" },
        key,
      ),
      409,
      problems.keyConflict,
    );

    // The provider's tenant learns of it through the consumer's outbox.
    const received = await asProvider(pair, proposed.id, 1);
    expect(received).toMatchObject({
      id: proposed.id,
      state: "proposed",
      message: "Please help us hire",
      counterparty: { domain: consumer.org.domain },
    });
    const clientList = (await (
      await provider.api.listClientEngagements(provider.owner)
    ).json()) as ListEngagementsResponse;
    expect(clientList.engagements.map((item) => item.id)).toEqual([
      proposed.id,
    ]);

    const acceptKey = orgsIdempotencyKey();
    const accepted = await provider.api.acceptEngagement(
      provider.owner,
      { engagement_id: proposed.id, version: 1 },
      acceptKey,
    );
    expect(accepted.status(), await accepted.text()).toBe(200);
    expect(accepted.headers()["cache-control"]).toBe("no-store");
    const active = (await accepted.json()) as Engagement;
    expect(active).toMatchObject({
      id: proposed.id,
      state: "active",
      version: 2,
      counterparty: { domain: consumer.org.domain },
    });
    expect(active.decided_at).toBeDefined();
    const acceptedAgain = await provider.api.acceptEngagement(
      provider.owner,
      { engagement_id: proposed.id, version: 1 },
      acceptKey,
    );
    expect(acceptedAgain.status(), await acceptedAgain.text()).toBe(200);
    expect(await acceptedAgain.json()).toEqual(active);
    // The authority already shows it; the provider's projection follows.
    expect(await asConsumer(pair, proposed.id)).toMatchObject({
      state: "active",
      version: 2,
    });
    expect(await asProvider(pair, proposed.id, 2)).toMatchObject({
      state: "active",
      version: 2,
    });

    const consumerRef = await consumer.api.setEngagementReference(
      consumer.owner,
      { engagement_id: proposed.id, version: 2, reference: "  PO-1001  " },
    );
    expect(consumerRef.status(), await consumerRef.text()).toBe(200);
    expect(await consumerRef.json()).toMatchObject({
      version: 3,
      consumer_reference: "PO-1001",
    });
    await asProvider(pair, proposed.id, 3);
    const providerRef = await provider.api.setClientEngagementReference(
      provider.owner,
      { engagement_id: proposed.id, version: 3, reference: "MSA-9" },
    );
    expect(providerRef.status(), await providerRef.text()).toBe(200);
    expect(await providerRef.json()).toMatchObject({
      version: 4,
      consumer_reference: "PO-1001",
      provider_reference: "MSA-9",
    });
    // Both sides see both references.
    expect(await asConsumer(pair, proposed.id)).toMatchObject({
      consumer_reference: "PO-1001",
      provider_reference: "MSA-9",
    });
    expect(await asProvider(pair, proposed.id, 4)).toMatchObject({
      consumer_reference: "PO-1001",
      provider_reference: "MSA-9",
    });
    await expectProblem(
      await provider.api.setClientEngagementReference(provider.owner, {
        engagement_id: proposed.id,
        version: 3,
        reference: "stale",
      }),
      409,
      engagementProblems.version,
    );
    const cleared = await consumer.api.setEngagementReference(consumer.owner, {
      engagement_id: proposed.id,
      version: 4,
    });
    expect(cleared.status(), await cleared.text()).toBe(200);
    const clearedBody = (await cleared.json()) as Engagement;
    expect(clearedBody.version).toBe(5);
    expect(clearedBody.consumer_reference).toBeUndefined();
    expect(clearedBody.provider_reference).toBe("MSA-9");

    await asProvider(pair, proposed.id, 5);
    const ended = await provider.api.endClientEngagement(provider.owner, {
      engagement_id: proposed.id,
      version: 5,
      note: "  Project done  ",
    });
    expect(ended.status(), await ended.text()).toBe(200);
    expect(await ended.json()).toMatchObject({
      state: "ended",
      version: 6,
      ended_by: "provider",
      end_note: "Project done",
    });
    expect(await asConsumer(pair, proposed.id)).toMatchObject({
      state: "ended",
      ended_by: "provider",
      end_note: "Project done",
      provider_reference: "MSA-9",
    });
    expect(await asProvider(pair, proposed.id, 6)).toMatchObject({
      state: "ended",
      ended_by: "provider",
    });
    // A terminal engagement stays readable and accepts no action but a
    // reference.
    await expectProblem(
      await consumer.api.endEngagement(consumer.owner, {
        engagement_id: proposed.id,
        version: 6,
      }),
      409,
      engagementProblems.state,
    );
    await expectProblem(
      await consumer.api.withdrawEngagement(consumer.owner, {
        engagement_id: proposed.id,
        version: 6,
      }),
      409,
      engagementProblems.state,
    );
    // A new proposal creates a new engagement.
    const again = await propose(pair);
    expect(again.id).not.toBe(proposed.id);
    expect(again.state).toBe("proposed");

    // The consumer's tenant audits every change; no free text is in it.
    const events = orgAuditEvents([proposed.id], "sgp");
    expect(events.map((event) => event.action)).toEqual([
      "org.engagement.proposed",
      "org.engagement.accepted",
      "org.engagement.reference_set",
      "org.engagement.reference_set",
      "org.engagement.reference_set",
      "org.engagement.ended",
    ]);
    const accept = events[1];
    expect(accept).toMatchObject({
      actor_type: "cross_tenant_caller",
      source: "federation-command",
    });
    expect(accept?.payload).toMatchObject({
      actor_display_name: provider.org.emailAddress,
      source_tenant_id: "deu",
    });
    const serialized = JSON.stringify(events);
    for (const secret of [
      "Please help us hire",
      "PO-1001",
      "MSA-9",
      "Project done",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

test("a consumer withdraws a proposal and the provider can no longer answer it", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withPair(request, {}, async (pair) => {
    const { consumer, provider } = pair;
    const proposed = await propose(pair);
    await asProvider(pair, proposed.id, 1);
    const key = orgsIdempotencyKey();
    const withdrawn = await consumer.api.withdrawEngagement(
      consumer.owner,
      { engagement_id: proposed.id, version: 1 },
      key,
    );
    expect(withdrawn.status(), await withdrawn.text()).toBe(200);
    expect(await withdrawn.json()).toMatchObject({
      state: "withdrawn",
      version: 2,
    });
    expect(orgAuditEventsByKey(key)[0]?.action).toBe(
      "org.engagement.withdrawn",
    );
    // A provider acting on what it last read is told it changed.
    await expectProblem(
      await provider.api.acceptEngagement(provider.owner, {
        engagement_id: proposed.id,
        version: 1,
      }),
      409,
      engagementProblems.version,
    );
    expect(await asProvider(pair, proposed.id, 2)).toMatchObject({
      state: "withdrawn",
    });
    for (const operation of [
      provider.api.acceptEngagement(provider.owner, {
        engagement_id: proposed.id,
        version: 2,
      }),
      provider.api.declineEngagement(provider.owner, {
        engagement_id: proposed.id,
        version: 2,
      }),
      provider.api.endClientEngagement(provider.owner, {
        engagement_id: proposed.id,
        version: 2,
      }),
      consumer.api.withdrawEngagement(consumer.owner, {
        engagement_id: proposed.id,
        version: 2,
      }),
      consumer.api.endEngagement(consumer.owner, {
        engagement_id: proposed.id,
        version: 2,
      }),
    ]) {
      await expectProblem(await operation, 409, engagementProblems.state);
    }
    // A terminal engagement still takes a reference.
    const reference = await provider.api.setClientEngagementReference(
      provider.owner,
      { engagement_id: proposed.id, version: 2, reference: "kept" },
    );
    expect(reference.status(), await reference.text()).toBe(200);
  });
});

test("a provider declines a proposal, and the consumer sees why nothing follows", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withPair(request, {}, async (pair) => {
    const { consumer, provider } = pair;
    const proposed = await propose(pair);
    await asProvider(pair, proposed.id, 1);
    const declined = await provider.api.declineEngagement(provider.owner, {
      engagement_id: proposed.id,
      version: 1,
    });
    expect(declined.status(), await declined.text()).toBe(200);
    const body = (await declined.json()) as Engagement;
    expect(body).toMatchObject({ state: "declined", version: 2 });
    expect(body.decided_at).toBeDefined();
    expect(await asConsumer(pair, proposed.id)).toMatchObject({
      state: "declined",
    });
    expect(await asProvider(pair, proposed.id, 2)).toMatchObject({
      state: "declined",
    });
    await expectProblem(
      await consumer.api.endEngagement(consumer.owner, {
        engagement_id: proposed.id,
        version: 2,
      }),
      409,
      engagementProblems.state,
    );
    await expectProblem(
      await provider.api.acceptEngagement(provider.owner, {
        engagement_id: proposed.id,
        version: 2,
      }),
      409,
      engagementProblems.state,
    );
  });
});

test("a consumer ends an active engagement and the provider sees who ended it", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withPair(request, { provider: "usa1" }, async (pair) => {
    const { consumer, provider } = pair;
    const proposed = await propose(pair);
    await asProvider(pair, proposed.id, 1);
    await expectProblem(
      await consumer.api.endEngagement(consumer.owner, {
        engagement_id: proposed.id,
        version: 1,
      }),
      409,
      engagementProblems.state,
    );
    const accepted = await provider.api.acceptEngagement(provider.owner, {
      engagement_id: proposed.id,
      version: 1,
    });
    expect(accepted.status(), await accepted.text()).toBe(200);
    const ended = await consumer.api.endEngagement(consumer.owner, {
      engagement_id: proposed.id,
      version: 2,
      note: "Budget moved",
    });
    expect(ended.status(), await ended.text()).toBe(200);
    expect(await ended.json()).toMatchObject({
      state: "ended",
      version: 3,
      ended_by: "consumer",
      end_note: "Budget moved",
    });
    expect(await asProvider(pair, proposed.id, 3)).toMatchObject({
      state: "ended",
      ended_by: "consumer",
      end_note: "Budget moved",
    });
    await expectProblem(
      await provider.api.endClientEngagement(provider.owner, {
        engagement_id: proposed.id,
        version: 3,
      }),
      409,
      engagementProblems.state,
    );
  });
});

test("an Org engages a provider in its own region", async ({ request }) => {
  test.setTimeout(90_000);
  await withPair(
    request,
    { consumer: "sgp", provider: "sgp" },
    async (pair) => {
      const proposed = await propose(pair);
      const received = await asProvider(pair, proposed.id, 1);
      expect(received.counterparty.domain).toBe(pair.consumer.org.domain);
      const accepted = await pair.provider.api.acceptEngagement(
        pair.provider.owner,
        { engagement_id: proposed.id, version: 1 },
      );
      expect(accepted.status(), await accepted.text()).toBe(200);
      expect(await asConsumer(pair, proposed.id)).toMatchObject({
        state: "active",
      });
    },
  );
});

test("proposals are refused for duplicates, itself, and Listings that cannot take engagements", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withPair(
    request,
    { capabilities: ["sourcing", "assessment"] },
    async (pair) => {
      const { consumer, provider } = pair;
      const proposal = (
        body: Partial<Parameters<OrgsAPI["proposeEngagement"]>[1]>,
      ) =>
        consumer.api.proposeEngagement(consumer.owner, {
          provider_domain: provider.org.domain,
          capability: "sourcing",
          ...body,
        });
      const proposed = await propose(pair);
      await expectProblem(await proposal({}), 409, engagementProblems.exists);
      await asProvider(pair, proposed.id, 1);
      const accepted = await provider.api.acceptEngagement(provider.owner, {
        engagement_id: proposed.id,
        version: 1,
      });
      expect(accepted.status(), await accepted.text()).toBe(200);
      await expectProblem(await proposal({}), 409, engagementProblems.exists);
      // Another Capability of the same provider is a different engagement.
      const other = await proposal({ capability: "assessment" });
      expect(other.status(), await other.text()).toBe(201);

      await expectProblem(
        await proposal({ provider_domain: consumer.org.domain }),
        422,
        engagementProblems.self,
      );
      await expectProblem(
        await proposal({ provider_domain: "nobody.example.test" }),
        409,
        engagementProblems.notAvailable,
      );
      await expectProblem(
        await proposal({ capability: "interviewing" }),
        409,
        engagementProblems.notAvailable,
      );

      // A Listing that is no longer listed takes no proposal.
      const listings = (await (
        await provider.api.listListings(provider.owner)
      ).json()) as { listings: { capability: string; version: number }[] };
      const assessment = listings.listings.find(
        (item) => item.capability === "assessment",
      );
      if (assessment === undefined) throw new Error("no assessment Listing");
      const unlisted = await provider.api.unlistListing(provider.owner, {
        capability: "assessment",
        version: assessment.version,
      });
      expect(unlisted.status(), await unlisted.text()).toBe(200);
      const otherID = ((await other.json()) as Engagement).id;
      await asProvider(pair, otherID, 1);
      const declined = await provider.api.declineEngagement(provider.owner, {
        engagement_id: otherID,
        version: 1,
      });
      expect(declined.status(), await declined.text()).toBe(200);
      await expectProblem(
        await proposal({ capability: "assessment" }),
        409,
        engagementProblems.notAvailable,
      );

      for (const bad of [
        { provider_domain: "x" },
        { capability: "plumbing" as never },
        { message: text(2001) },
        { message: "" },
      ]) {
        await expectProblem(await proposal(bad), 400, problems.validation);
      }
    },
  );
});

test("a suspended or unreachable provider takes no proposal", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withPair(request, {}, async (pair) => {
    const { consumer, provider } = pair;
    const suspend = (state: "suspended" | "active") =>
      orgSQL(
        `UPDATE vetchium.orgs SET org_state = '${state}',
           suspended_at = ${state === "suspended" ? "now()" : "NULL"}
         WHERE org_did = (SELECT org_did FROM vetchium.org_domains
           WHERE domain = '${provider.org.domain}')`,
        "deu",
      );
    suspend("suspended");
    await expectProblem(
      await consumer.api.proposeEngagement(consumer.owner, {
        provider_domain: provider.org.domain,
        capability: "sourcing",
      }),
      409,
      engagementProblems.notAvailable,
    );
    suspend("active");
    const proposed = await propose(pair);
    expect(proposed.state).toBe("proposed");

    const did = orgDID(provider.org.domain, "deu");
    setOrgHome(did, "gone");
    try {
      await expectProblem(
        await consumer.api.proposeEngagement(consumer.owner, {
          provider_domain: provider.org.domain,
          capability: "interviewing",
        }),
        503,
        problems.unavailable,
      );
    } finally {
      setOrgHome(did, "deu");
    }
  });
});

test("a downgrade stops acceptance and new proposals while active engagements continue", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withPair(
    request,
    { capabilities: ["sourcing", "interviewing", "assessment"] },
    async (pair) => {
      const { consumer, provider } = pair;
      const live = await propose(pair, "interviewing");
      const waiting = await propose(pair, "assessment");
      await asProvider(pair, live.id, 1);
      await asProvider(pair, waiting.id, 1);
      const accepted = await provider.api.acceptEngagement(provider.owner, {
        engagement_id: live.id,
        version: 1,
      });
      expect(accepted.status(), await accepted.text()).toBe(200);

      const downgrade = await provider.api.setSubscriptionPlan(provider.owner, {
        plan_oid: "org-free-tier",
      });
      expect(downgrade.status(), await downgrade.text()).toBe(200);

      // The Listing is no longer listed, so the provider cannot accept...
      await expectProblem(
        await provider.api.acceptEngagement(provider.owner, {
          engagement_id: waiting.id,
          version: 1,
        }),
        409,
        engagementProblems.notAvailable,
      );
      // ...and a consumer cannot propose, but declining needs no Listing.
      await expectProblem(
        await consumer.api.proposeEngagement(consumer.owner, {
          provider_domain: provider.org.domain,
          capability: "sourcing",
        }),
        409,
        engagementProblems.notAvailable,
      );
      const declined = await provider.api.declineEngagement(provider.owner, {
        engagement_id: waiting.id,
        version: 1,
      });
      expect(declined.status(), await declined.text()).toBe(200);

      // The active engagement continues.
      const reference = await consumer.api.setEngagementReference(
        consumer.owner,
        { engagement_id: live.id, version: 2, reference: "still on" },
      );
      expect(reference.status(), await reference.text()).toBe(200);
      expect(await asConsumer(pair, live.id)).toMatchObject({
        state: "active",
      });
      await onSilver(provider.api, provider.owner);
    },
  );
});

test("a proposal that waits thirty days expires on both sides", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withPair(request, {}, async (pair) => {
    const { consumer, provider } = pair;
    const proposed = await propose(pair);
    await asProvider(pair, proposed.id, 1);
    orgSQL(
      `UPDATE vetchium.org_engagements
       SET proposed_at = now() - interval '31 days',
         expires_at = now() - interval '1 day'
       WHERE engagement_id = '${proposed.id}'`,
      "sgp",
    );
    await expect
      .poll(async () => (await asConsumer(pair, proposed.id)).state, {
        timeout: 30_000,
      })
      .toBe("expired");
    expect((await asConsumer(pair, proposed.id)).version).toBe(2);
    expect(await asProvider(pair, proposed.id, 2)).toMatchObject({
      state: "expired",
    });
    const events = orgAuditEvents([proposed.id], "sgp");
    expect(events.at(-1)).toMatchObject({
      action: "org.engagement.expired",
      actor_type: "worker",
    });
    await expectProblem(
      await provider.api.acceptEngagement(provider.owner, {
        engagement_id: proposed.id,
        version: 2,
      }),
      409,
      engagementProblems.state,
    );
    await expectProblem(
      await consumer.api.withdrawEngagement(consumer.owner, {
        engagement_id: proposed.id,
        version: 2,
      }),
      409,
      engagementProblems.state,
    );
    // An expired proposal frees the pair for a new one.
    expect((await propose(pair)).state).toBe("proposed");
  });
});

test("lists put proposals first, then active, then the rest, and paginate", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withPair(
    request,
    { capabilities: ["sourcing", "interviewing", "assessment"] },
    async (pair) => {
      const { consumer, provider } = pair;
      const sourcing = await propose(pair, "sourcing");
      const interviewing = await propose(pair, "interviewing");
      const assessment = await propose(pair, "assessment");
      await asProvider(pair, interviewing.id, 1);
      await asProvider(pair, assessment.id, 1);
      expect(
        (
          await provider.api.acceptEngagement(provider.owner, {
            engagement_id: interviewing.id,
            version: 1,
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await provider.api.declineEngagement(provider.owner, {
            engagement_id: assessment.id,
            version: 1,
          })
        ).status(),
      ).toBe(200);
      await asProvider(pair, interviewing.id, 2);
      await asProvider(pair, assessment.id, 2);
      await asProvider(pair, sourcing.id, 1);

      const order = [sourcing.id, interviewing.id, assessment.id];
      for (const side of [
        { api: consumer.api, token: consumer.owner, client: false },
        { api: provider.api, token: provider.owner, client: true },
      ]) {
        const list = (
          request: Parameters<OrgsAPI["listEngagements"]>[1] = {},
        ) =>
          side.client
            ? side.api.listClientEngagements(side.token, request)
            : side.api.listEngagements(side.token, request);
        const all = await list();
        expect(all.status(), await all.text()).toBe(200);
        expect(all.headers()["cache-control"]).toBe("no-store");
        const page = (await all.json()) as ListEngagementsResponse;
        expect(page.engagements.map((item) => item.id)).toEqual(order);
        expect(page.engagements.map((item) => item.state)).toEqual([
          "proposed",
          "active",
          "declined",
        ]);
        expect(JSON.stringify(page)).not.toMatch(moneyKey);

        const first = (await (
          await list({ limit: 2 })
        ).json()) as ListEngagementsResponse;
        expect(first.engagements.map((item) => item.id)).toEqual(
          order.slice(0, 2),
        );
        const key = first.next_pagination_key;
        if (key === undefined) throw new Error("missing pagination key");
        const second = (await (
          await list({ limit: 2, pagination_key: key })
        ).json()) as ListEngagementsResponse;
        expect(second.engagements.map((item) => item.id)).toEqual(
          order.slice(2),
        );
        expect(second.next_pagination_key).toBeUndefined();

        for (const [filter, want] of [
          [{ state: "active" as EngagementState }, [interviewing.id]],
          [{ capability: "assessment" as Capability }, [assessment.id]],
          [{ state: "ended" as EngagementState }, []],
        ] as const) {
          const filtered = (await (
            await list(filter)
          ).json()) as ListEngagementsResponse;
          expect(filtered.engagements.map((item) => item.id)).toEqual(want);
        }
        await expectProblem(
          await list({ limit: 2, state: "active", pagination_key: key }),
          400,
          problems.paginationKey,
        );
        await expectProblem(
          await list({ limit: 2, pagination_key: `${key}x` }),
          400,
          problems.paginationKey,
        );
      }
    },
  );
});

test("engagements are visible to their two Orgs alone", async ({ request }) => {
  test.setTimeout(90_000);
  await withPair(request, {}, async (pair) => {
    const proposed = await propose(pair);
    await asProvider(pair, proposed.id, 1);
    await withProvider(request, async (stranger) => {
      const target = { engagement_id: proposed.id, version: 1 };
      for (const attempt of [
        stranger.api.getEngagement(stranger.owner, {
          engagement_id: proposed.id,
        }),
        stranger.api.getClientEngagement(stranger.owner, {
          engagement_id: proposed.id,
        }),
        stranger.api.withdrawEngagement(stranger.owner, target),
        stranger.api.endEngagement(stranger.owner, target),
        stranger.api.setEngagementReference(stranger.owner, target),
        stranger.api.acceptEngagement(stranger.owner, target),
        stranger.api.declineEngagement(stranger.owner, target),
        stranger.api.endClientEngagement(stranger.owner, target),
        stranger.api.setClientEngagementReference(stranger.owner, target),
      ]) {
        await expectProblem(await attempt, 404, engagementProblems.notFound);
      }
      for (const response of [
        await stranger.api.listEngagements(stranger.owner),
        await stranger.api.listClientEngagements(stranger.owner),
      ]) {
        expect(
          ((await response.json()) as ListEngagementsResponse).engagements,
        ).toEqual([]);
      }
    });
    // Each party cannot act as the other.
    const target = { engagement_id: proposed.id, version: 1 };
    await expectProblem(
      await pair.provider.api.getEngagement(pair.provider.owner, {
        engagement_id: proposed.id,
      }),
      404,
      engagementProblems.notFound,
    );
    await expectProblem(
      await pair.consumer.api.getClientEngagement(pair.consumer.owner, {
        engagement_id: proposed.id,
      }),
      404,
      engagementProblems.notFound,
    );
    await expectProblem(
      await pair.provider.api.withdrawEngagement(pair.provider.owner, target),
      404,
      engagementProblems.notFound,
    );
    await expectProblem(
      await pair.consumer.api.acceptEngagement(pair.consumer.owner, target),
      404,
      engagementProblems.notFound,
    );
  });
});

test("engagement routes authenticate, authorize, validate, and refuse suspended Orgs", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withPair(request, { provider: "sgp" }, async (pair) => {
    const { consumer, provider } = pair;
    const proposed = await propose(pair);
    await asProvider(pair, proposed.id, 1);
    const id = proposed.id;
    const target = { engagement_id: id, version: 1 };
    const consumerRoutes = [
      { path: "/list-engagements", body: {}, write: false },
      { path: "/get-engagement", body: { engagement_id: id }, write: false },
      {
        path: "/propose-engagement",
        body: {
          provider_domain: provider.org.domain,
          capability: "assessment",
        },
        write: true,
      },
      { path: "/withdraw-engagement", body: target, write: true },
      { path: "/end-engagement", body: target, write: true },
      { path: "/set-engagement-reference", body: target, write: true },
    ];
    const providerRoutes = [
      { path: "/list-client-engagements", body: {}, write: false },
      {
        path: "/get-client-engagement",
        body: { engagement_id: id },
        write: false,
      },
      { path: "/accept-engagement", body: target, write: true },
      { path: "/decline-engagement", body: target, write: true },
      { path: "/end-client-engagement", body: target, write: true },
      { path: "/set-client-engagement-reference", body: target, write: true },
    ];
    const routes = [...consumerRoutes, ...providerRoutes];
    const keyed = (write: boolean) =>
      write ? { idempotencyKey: orgsIdempotencyKey() } : {};
    for (const route of routes) {
      await expectProblem(
        await consumer.api.post(route.path, route.body, keyed(route.write)),
        401,
        problems.authentication,
      );
      await expectProblem(
        await consumer.api.postRaw(route.path, "{", {
          token: consumer.owner,
          ...keyed(route.write),
        }),
        400,
        problems.invalidJSON,
      );
      if (route.write) {
        const missingKey = await consumer.api.post(route.path, route.body, {
          token: consumer.owner,
        });
        expect(missingKey.status(), route.path).toBe(400);
      }
    }
    for (const [path, bad] of [
      ["/list-engagements", { limit: 0 }],
      ["/list-client-engagements", { state: "paused" }],
      ["/get-engagement", { engagement_id: "x" }],
      ["/get-client-engagement", { engagement_id: "X" }],
      ["/propose-engagement", { provider_domain: "x", capability: "q" }],
      [
        "/propose-engagement",
        {
          provider_domain: "a.test",
          capability: "sourcing",
          message: text(2001),
        },
      ],
      ["/withdraw-engagement", { engagement_id: id, version: 0 }],
      ["/end-engagement", { ...target, note: text(2001) }],
      ["/set-engagement-reference", { ...target, reference: text(201) }],
      ["/accept-engagement", { engagement_id: "x", version: 1 }],
      ["/decline-engagement", { engagement_id: id, version: -1 }],
      ["/end-client-engagement", { ...target, note: "" }],
      ["/set-client-engagement-reference", { ...target, reference: text(201) }],
    ] as const) {
      await expectProblem(
        await consumer.api.marketplaceWriteRaw(path, consumer.owner, bad),
        400,
        problems.validation,
      );
    }

    const lister = await addOrgMember(
      consumer.api,
      consumer.owner,
      consumer.org.domain,
      inviteeAddress(consumer.org.domain, "lister"),
      ["org:manage_listings"],
    );
    const buyer = await addOrgMember(
      consumer.api,
      consumer.owner,
      consumer.org.domain,
      inviteeAddress(consumer.org.domain, "buyer"),
      ["org:manage_providers"],
    );
    const plain = await addOrgMember(
      consumer.api,
      consumer.owner,
      consumer.org.domain,
      inviteeAddress(consumer.org.domain, "plain"),
      [],
    );
    const attempt = (route: (typeof routes)[number], token: string) =>
      consumer.api.post(route.path, route.body, {
        token,
        ...keyed(route.write),
      });
    for (const route of routes) {
      await expectProblem(
        await attempt(route, plain.token),
        403,
        problems.permission,
      );
    }
    for (const route of providerRoutes) {
      await expectProblem(
        await attempt(route, buyer.token),
        403,
        problems.permission,
      );
    }
    for (const route of consumerRoutes) {
      await expectProblem(
        await attempt(route, lister.token),
        403,
        problems.permission,
      );
    }
    expect(
      (await attempt(consumerRoutes[0] as never, buyer.token)).status(),
    ).toBe(200);
    expect(
      (await attempt(providerRoutes[0] as never, lister.token)).status(),
    ).toBe(200);

    orgSQL(`UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
      WHERE org_did = (SELECT org_did FROM vetchium.org_domains
        WHERE domain = '${consumer.org.domain}')`);
    for (const route of routes) {
      await expectProblem(
        await attempt(route, consumer.owner),
        403,
        problems.suspended,
      );
    }
  });
});

test("every engagement write names a stale version and a reused key", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withPair(
    request,
    { capabilities: ["sourcing", "assessment"] },
    async (pair) => {
      const { consumer, provider } = pair;
      const live = await propose(pair, "sourcing");
      const waiting = await propose(pair, "assessment");
      await asProvider(pair, live.id, 1);
      await asProvider(pair, waiting.id, 1);
      const accepted = await provider.api.acceptEngagement(provider.owner, {
        engagement_id: live.id,
        version: 1,
      });
      expect(accepted.status(), await accepted.text()).toBe(200);

      const id = live.id;
      const consumerWrites = [
        (version: number) =>
          consumer.api.withdrawEngagement(consumer.owner, {
            engagement_id: id,
            version,
          }),
        (version: number) =>
          consumer.api.endEngagement(consumer.owner, {
            engagement_id: id,
            version,
          }),
        (version: number) =>
          consumer.api.setEngagementReference(consumer.owner, {
            engagement_id: id,
            version,
          }),
      ];
      // A provider's command is stored with its rejection, so reusing its key
      // for another request is a conflict even after a stale version.
      const providerWrites = [
        (version: number, key: string) =>
          provider.api.acceptEngagement(
            provider.owner,
            { engagement_id: id, version },
            key,
          ),
        (version: number, key: string) =>
          provider.api.declineEngagement(
            provider.owner,
            { engagement_id: id, version },
            key,
          ),
        (version: number, key: string) =>
          provider.api.endClientEngagement(
            provider.owner,
            { engagement_id: id, version },
            key,
          ),
        (version: number, key: string) =>
          provider.api.setClientEngagementReference(
            provider.owner,
            { engagement_id: id, version },
            key,
          ),
      ];
      for (const write of consumerWrites) {
        await expectProblem(await write(99), 409, engagementProblems.version);
      }
      for (const write of providerWrites) {
        const key = orgsIdempotencyKey();
        await expectProblem(
          await write(99, key),
          409,
          engagementProblems.version,
        );
        await expectProblem(await write(98, key), 409, problems.keyConflict);
      }

      // A consumer's write that succeeded is replayed for its key, and the key
      // refuses any other request.
      const referenceKey = orgsIdempotencyKey();
      const referenced = await consumer.api.setEngagementReference(
        consumer.owner,
        { engagement_id: id, version: 2, reference: "PO-7" },
        referenceKey,
      );
      expect(referenced.status(), await referenced.text()).toBe(200);
      await expectProblem(
        await consumer.api.setEngagementReference(
          consumer.owner,
          { engagement_id: id, version: 2, reference: "PO-8" },
          referenceKey,
        ),
        409,
        problems.keyConflict,
      );
      const withdrawKey = orgsIdempotencyKey();
      const withdrawn = await consumer.api.withdrawEngagement(
        consumer.owner,
        { engagement_id: waiting.id, version: 1 },
        withdrawKey,
      );
      expect(withdrawn.status(), await withdrawn.text()).toBe(200);
      await expectProblem(
        await consumer.api.withdrawEngagement(
          consumer.owner,
          { engagement_id: waiting.id, version: 2 },
          withdrawKey,
        ),
        409,
        problems.keyConflict,
      );
      const endKey = orgsIdempotencyKey();
      const ended = await consumer.api.endEngagement(
        consumer.owner,
        { engagement_id: id, version: 3, note: "Done" },
        endKey,
      );
      expect(ended.status(), await ended.text()).toBe(200);
      await expectProblem(
        await consumer.api.endEngagement(
          consumer.owner,
          { engagement_id: id, version: 3, note: "Other" },
          endKey,
        ),
        409,
        problems.keyConflict,
      );
    },
  );
});

test("provider commands that cannot be delivered are refused, or left pending and recovered", async ({
  request,
}) => {
  test.setTimeout(150_000);
  await withPair(
    request,
    { capabilities: ["sourcing", "assessment"] },
    async (pair) => {
      const { consumer, provider } = pair;
      const live = await propose(pair, "sourcing");
      const waiting = await propose(pair, "assessment");
      await asProvider(pair, live.id, 1);
      await asProvider(pair, waiting.id, 1);
      const did = orgDID(consumer.org.domain, "sgp");
      const state = async (operationID: string) => {
        const response = await provider.api.operationStatus(provider.owner, {
          operation_id: operationID,
        });
        expect(response.status(), await response.text()).toBe(200);
        return ((await response.json()) as OperationStatus).state;
      };
      // Each command carries the version it will find once the ones before it
      // have run: accept, then a reference, then the end; and a decline of the
      // other proposal.
      const sends: {
        name: string;
        key: string;
        send: (key: string) => Promise<APIResponse>;
        result: Record<string, unknown>;
      }[] = [
        {
          name: "accept",
          key: orgsIdempotencyKey(),
          send: (key) =>
            provider.api.acceptEngagement(
              provider.owner,
              { engagement_id: live.id, version: 1 },
              key,
            ),
          result: { state: "active", version: 2 },
        },
        {
          name: "reference",
          key: orgsIdempotencyKey(),
          send: (key) =>
            provider.api.setClientEngagementReference(
              provider.owner,
              { engagement_id: live.id, version: 2, reference: "MSA-1" },
              key,
            ),
          result: { provider_reference: "MSA-1", version: 3 },
        },
        {
          name: "end",
          key: orgsIdempotencyKey(),
          send: (key) =>
            provider.api.endClientEngagement(
              provider.owner,
              { engagement_id: live.id, version: 3, note: "Done" },
              key,
            ),
          result: { state: "ended", ended_by: "provider", version: 4 },
        },
        {
          name: "decline",
          key: orgsIdempotencyKey(),
          send: (key) =>
            provider.api.declineEngagement(
              provider.owner,
              { engagement_id: waiting.id, version: 1 },
              key,
            ),
          result: { state: "declined", version: 2 },
        },
      ];
      try {
        // The route names a tenant that does not exist: nothing is sent.
        setOrgHome(did, "gone");
        for (const item of sends) {
          await expectProblem(
            await item.send(orgsIdempotencyKey()),
            503,
            problems.unavailable,
          );
        }
        // The route names a tenant that does not home the consumer: the
        // command was sent, so its outcome is unknown.
        setOrgHome(did, "usa1");
        const operations: string[] = [];
        for (const item of sends) {
          const pending = await item.send(item.key);
          expect(
            pending.status(),
            `${item.name}: ${await pending.text()}`,
          ).toBe(202);
          expect(pending.headers()["cache-control"]).toBe("no-store");
          const operation = (await pending.json()) as { operation_id: string };
          expect(await state(operation.operation_id)).toBe("pending");
          operations.push(operation.operation_id);
        }
        setOrgHome(did, "sgp");
        for (const [index, item] of sends.entries()) {
          const recovered = await item.send(item.key);
          expect(
            recovered.status(),
            `${item.name}: ${await recovered.text()}`,
          ).toBe(200);
          expect(await recovered.json()).toMatchObject(item.result);
          expect(await state(operations[index] ?? "")).toBe("succeeded");
        }
        expect(await asConsumer(pair, live.id)).toMatchObject({
          state: "ended",
          provider_reference: "MSA-1",
        });
        expect(await asConsumer(pair, waiting.id)).toMatchObject({
          state: "declined",
        });
      } finally {
        setOrgHome(did, "sgp");
      }
    },
  );
});

test("concurrent proposals for one pair and Capability make exactly one", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withPair(request, {}, async ({ consumer, provider }) => {
    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        consumer.api.proposeEngagement(consumer.owner, {
          provider_domain: provider.org.domain,
          capability: "sourcing",
        }),
      ),
    );
    const statuses = responses.map((response) => response.status()).sort();
    expect(statuses).toEqual([201, 409, 409]);
    for (const response of responses.filter((item) => item.status() === 409)) {
      await expectProblem(response, 409, engagementProblems.exists);
    }
    const list = (await (
      await consumer.api.listEngagements(consumer.owner)
    ).json()) as ListEngagementsResponse;
    expect(list.engagements).toHaveLength(1);
  });
});
