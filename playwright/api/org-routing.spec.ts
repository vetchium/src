import { randomUUID } from "node:crypto";
import type {
  ApplicationDetail,
  ApplicationSummary,
  ListApplicationHistoryResponse,
  ListApplicationsResponse,
} from "typespec/orgs/applications/applications";
import type { OpeningProviders } from "typespec/orgs/marketplace/assignments";
import type { Listing } from "typespec/orgs/marketplace/listings";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { expectProblem } from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import {
  cleanupApplicants,
  type HiringOrg,
  seedApplicationNumber,
} from "../lib/hiring-seed.ts";
import { meshPeerRequest, meshRelayRequest } from "../lib/mesh.ts";
import {
  addOrgMember,
  inviteeAddress,
  orgDID,
  orgSQL,
  orgsIdempotencyKey,
} from "../lib/orgs-api.ts";
import {
  cleanupOutbox,
  detailOf,
  publishedOpening,
  stageOf,
} from "../lib/orgs-applications.ts";
import {
  activate,
  asConsumer,
  asProvider,
  problems,
  propose,
  setOrgHome,
  withPair,
} from "../lib/orgs-marketplace.ts";
import {
  assign,
  candidate,
  route,
  routed,
  seedEngagements,
  type World,
  withWorld,
} from "../lib/orgs-routing.ts";

const base = "vetchium-problem-details/";
const routing = {
  mismatch: `${base}org-engagement-capability-mismatch`,
  exists: `${base}org-assignment-exists`,
  assignmentNotFound: `${base}org-assignment-not-found`,
  limit: `${base}org-assignment-limit-reached`,
  engagementNotFound: `${base}org-engagement-not-found`,
  engagementState: `${base}org-engagement-state-conflict`,
  openingNotFound: `${base}org-opening-not-found`,
  openingState: `${base}org-opening-state-conflict`,
  applicationState: `${base}org-application-state-conflict`,
  applicationVersion: `${base}org-application-version-conflict`,
  applicationNotFound: `${base}org-application-not-found`,
};

function routeRows(world: World, application: ApplicationDetail): number {
  return Number(
    orgSQL(
      `SELECT count(*) FROM vetchium.org_application_routes
       WHERE org_application_id = (
         SELECT a.org_application_id FROM vetchium.org_applications AS a
         JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
         WHERE o.org_did = (SELECT org_did FROM vetchium.org_domains
           WHERE domain = '${world.pair.consumer.org.domain}')
           AND o.opening_number = ${world.opening.opening_number}
           AND a.application_number = ${application.application_number})`,
    ),
  );
}

test("assignments attach engagements to an Opening and its stages", async ({
  request,
}) => {
  test.setTimeout(150_000);
  await withWorld(request, async (world) => {
    const { pair, opening, panel, screen, check } = world;
    const { consumer } = pair;
    const sourcing = await activate(pair, "sourcing");
    const interviewing = await activate(pair, "interviewing");
    const assessment = await activate(pair, "assessment");
    const pending = await propose(pair, "background_check");

    const empty = (await (
      await consumer.api.getOpeningProviders(consumer.owner, {
        opening_number: opening.opening_number,
      })
    ).json()) as OpeningProviders;
    expect(empty.agencies).toEqual([]);
    expect(empty.stages.map((item) => item.stage.name)).toEqual([
      "Screen",
      "Panel",
      "Final",
      "Assess",
      "Check",
    ]);
    expect(empty.stages.every((item) => item.assignments.length === 0)).toBe(
      true,
    );

    const key = orgsIdempotencyKey();
    const body = {
      opening_number: opening.opening_number,
      engagement_id: sourcing.id,
    };
    const first = await consumer.api.assignOpeningProvider(
      consumer.owner,
      body,
      key,
    );
    expect(first.status(), await first.text()).toBe(200);
    const agencies = (await first.json()) as OpeningProviders;
    expect(agencies.agencies).toMatchObject([
      {
        engagement_id: sourcing.id,
        capability: "sourcing",
        counterparty: { domain: pair.provider.org.domain },
      },
    ]);
    const replay = await consumer.api.assignOpeningProvider(
      consumer.owner,
      body,
      key,
    );
    expect(replay.status(), await replay.text()).toBe(200);
    expect(await replay.json()).toEqual(agencies);
    await expectProblem(
      await consumer.api.assignOpeningProvider(consumer.owner, body),
      409,
      routing.exists,
    );
    await expectProblem(
      await consumer.api.assignOpeningProvider(
        consumer.owner,
        { ...body, engagement_id: interviewing.id },
        key,
      ),
      409,
      problems.keyConflict,
    );
    await expectProblem(
      await consumer.api.getOpeningProviders(consumer.owner, {
        opening_number: 9999,
      }),
      404,
      routing.openingNotFound,
    );

    const staged = await assign(world, interviewing.id, panel);
    expect(
      staged.stages.find((item) => item.stage.id === panel.id)?.assignments,
    ).toMatchObject([{ engagement_id: interviewing.id }]);
    expect(staged.agencies).toHaveLength(1);
    await expectProblem(
      await consumer.api.assignOpeningProvider(consumer.owner, {
        opening_number: opening.opening_number,
        engagement_id: interviewing.id,
        stage_id: panel.id,
      }),
      409,
      routing.exists,
    );

    // The Capability must perform the kind of the stage it is assigned to.
    for (const [engagement, stage] of [
      [interviewing.id, screen],
      [interviewing.id, check],
      [assessment.id, panel],
    ] as const) {
      await expectProblem(
        await consumer.api.assignOpeningProvider(consumer.owner, {
          opening_number: opening.opening_number,
          engagement_id: engagement,
          stage_id: stage.id,
        }),
        422,
        routing.mismatch,
      );
    }
    await expectProblem(
      await consumer.api.assignOpeningProvider(consumer.owner, {
        opening_number: opening.opening_number,
        engagement_id: sourcing.id,
        stage_id: panel.id,
      }),
      422,
      routing.mismatch,
    );
    await expectProblem(
      await consumer.api.assignOpeningProvider(consumer.owner, {
        opening_number: opening.opening_number,
        engagement_id: assessment.id,
      }),
      422,
      routing.mismatch,
    );

    await expectProblem(
      await consumer.api.assignOpeningProvider(consumer.owner, {
        opening_number: opening.opening_number,
        engagement_id: pending.id,
        stage_id: check.id,
      }),
      409,
      routing.engagementState,
    );
    await expectProblem(
      await consumer.api.assignOpeningProvider(consumer.owner, {
        opening_number: opening.opening_number,
        engagement_id: randomUUID(),
      }),
      404,
      routing.engagementNotFound,
    );
    await expectProblem(
      await consumer.api.assignOpeningProvider(consumer.owner, {
        opening_number: opening.opening_number,
        engagement_id: interviewing.id,
        stage_id: randomUUID(),
      }),
      400,
      problems.validation,
      ["stage_id"],
    );
    await expectProblem(
      await consumer.api.assignOpeningProvider(consumer.owner, {
        opening_number: 9999,
        engagement_id: sourcing.id,
      }),
      404,
      routing.openingNotFound,
    );
    await expectProblem(
      await pair.provider.api.assignOpeningProvider(pair.provider.owner, {
        opening_number: opening.opening_number,
        engagement_id: sourcing.id,
      }),
      404,
      routing.openingNotFound,
    );

    // Unassigning removes one assignment and says so.
    const key2 = orgsIdempotencyKey();
    const removed = await consumer.api.unassignOpeningProvider(
      consumer.owner,
      {
        opening_number: opening.opening_number,
        engagement_id: interviewing.id,
        stage_id: panel.id,
      },
      key2,
    );
    expect(removed.status(), await removed.text()).toBe(200);
    expect(
      ((await removed.json()) as OpeningProviders).stages.every(
        (item) => item.assignments.length === 0,
      ),
    ).toBe(true);
    await expectProblem(
      await consumer.api.unassignOpeningProvider(
        consumer.owner,
        {
          opening_number: opening.opening_number,
          engagement_id: sourcing.id,
        },
        key2,
      ),
      409,
      problems.keyConflict,
    );
    await expectProblem(
      await consumer.api.unassignOpeningProvider(consumer.owner, {
        opening_number: opening.opening_number,
        engagement_id: interviewing.id,
        stage_id: panel.id,
      }),
      404,
      routing.assignmentNotFound,
    );
    await expectProblem(
      await consumer.api.unassignOpeningProvider(consumer.owner, {
        opening_number: opening.opening_number,
        engagement_id: sourcing.id,
        stage_id: panel.id,
      }),
      404,
      routing.assignmentNotFound,
    );
    await expectProblem(
      await consumer.api.unassignOpeningProvider(consumer.owner, {
        opening_number: 9999,
        engagement_id: sourcing.id,
      }),
      404,
      routing.openingNotFound,
    );

    // A closed Opening takes no new provider but can drop one.
    const closed = await consumer.api.requestOpeningChange(consumer.owner, {
      opening_number: opening.opening_number,
      version: (
        (await (
          await consumer.api.getOpening(consumer.owner, {
            opening_number: opening.opening_number,
          })
        ).json()) as OrgOpening
      ).version,
      kind: "close",
    });
    expect(closed.status(), await closed.text()).toBe(200);
    await expectProblem(
      await consumer.api.assignOpeningProvider(consumer.owner, {
        opening_number: opening.opening_number,
        engagement_id: interviewing.id,
        stage_id: panel.id,
      }),
      409,
      routing.openingState,
    );
    const dropped = await consumer.api.unassignOpeningProvider(consumer.owner, {
      opening_number: opening.opening_number,
      engagement_id: sourcing.id,
    });
    expect(dropped.status(), await dropped.text()).toBe(200);
  });
});

test("an Opening takes twenty agencies and a stage ten providers", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withWorld(request, async (world) => {
    const { pair, opening, panel } = world;
    const { consumer } = pair;
    const agencies = await seedEngagements(world, "sourcing", 20);
    for (const id of agencies) {
      await assign(world, id);
    }
    const real = await activate(pair, "sourcing");
    const over = await consumer.api.assignOpeningProvider(consumer.owner, {
      opening_number: opening.opening_number,
      engagement_id: real.id,
    });
    await expectProblem(over, 409, routing.limit);
    expect(((await over.json()) as { limit: number }).limit).toBe(20);

    const panelists = await seedEngagements(world, "interviewing", 10);
    for (const id of panelists) {
      await assign(world, id, panel);
    }
    const realPanel = await activate(pair, "interviewing");
    const overStage = await consumer.api.assignOpeningProvider(consumer.owner, {
      opening_number: opening.opening_number,
      engagement_id: realPanel.id,
      stage_id: panel.id,
    });
    await expectProblem(overStage, 409, routing.limit);
    expect(((await overStage.json()) as { limit: number }).limit).toBe(10);
    // Another stage has its own ten.
    const other = await assign(world, realPanel.id, world.final);
    expect(
      other.stages.find((item) => item.stage.id === world.final.id)
        ?.assignments,
    ).toHaveLength(1);
    const providers = (await (
      await consumer.api.getOpeningProviders(consumer.owner, {
        opening_number: opening.opening_number,
      })
    ).json()) as OpeningProviders;
    expect(providers.agencies).toHaveLength(20);
    expect(
      providers.stages.find((item) => item.stage.id === panel.id)?.assignments,
    ).toHaveLength(10);
    // Removing one makes room.
    const first = agencies[0];
    if (first === undefined) throw new Error("no seeded agency");
    expect(
      (
        await consumer.api.unassignOpeningProvider(consumer.owner, {
          opening_number: opening.opening_number,
          engagement_id: first,
        })
      ).status(),
    ).toBe(200);
    await assign(world, real.id);
  });
});

test("a candidacy is routed to a provider assigned to its stage, rerouted, and brought back in-house", async ({
  request,
}) => {
  test.setTimeout(150_000);
  await withWorld(request, async (world) => {
    const { pair, opening, panel, screen } = world;
    const { consumer, provider } = pair;
    const real = await activate(pair, "interviewing");
    const [other] = await seedEngagements(world, "interviewing", 1);
    const [unassigned] = await seedEngagements(world, "interviewing", 1);
    if (other === undefined || unassigned === undefined)
      throw new Error("no seeded engagements");
    await assign(world, real.id, panel);
    await assign(world, other, panel);

    const waiting = await candidate(world, panel);
    expect(waiting).toMatchObject({ state: "in_pipeline", version: 2 });
    expect(waiting.route).toBeUndefined();

    const key = orgsIdempotencyKey();
    const response = await route(world, waiting, real.id, consumer.owner, key);
    expect(response.status(), await response.text()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const toReal = (await response.json()) as ApplicationDetail;
    expect(toReal).toMatchObject({
      version: 3,
      route: {
        engagement_id: real.id,
        capability: "interviewing",
        provider: { domain: provider.org.domain },
      },
    });
    const replay = await route(world, waiting, real.id, consumer.owner, key);
    expect(replay.status(), await replay.text()).toBe(200);
    expect(await replay.json()).toEqual(toReal);

    const history = (await (
      await consumer.api.listApplicationHistory(consumer.owner, {
        opening_number: opening.opening_number,
        application_number: waiting.application_number,
      })
    ).json()) as ListApplicationHistoryResponse;
    expect(history.entries.map((entry) => entry.action)).toContain("routed");
    expect(
      history.entries.find((entry) => entry.action === "routed")?.stage?.id,
    ).toBe(panel.id);

    await expectProblem(
      await route(world, waiting, other, consumer.owner, key),
      409,
      problems.keyConflict,
    );
    await expectProblem(
      await route(world, toReal, real.id),
      409,
      routing.applicationState,
    );
    await expectProblem(
      await route(world, waiting, other),
      409,
      routing.applicationVersion,
    );
    await expectProblem(
      await route(world, toReal, unassigned),
      404,
      routing.assignmentNotFound,
    );
    await expectProblem(
      await route(world, toReal, randomUUID()),
      404,
      routing.assignmentNotFound,
    );

    // Rerouting replaces the route.
    const toOther = await routed(world, toReal, other);
    expect(toOther).toMatchObject({
      version: 4,
      route: { engagement_id: other },
    });
    const listed = async (extra: object = {}) => {
      const result = await consumer.api.listApplications(consumer.owner, {
        opening_number: opening.opening_number,
        view: "candidates",
        ...extra,
      });
      expect(result.status(), await result.text()).toBe(200);
      return ((await result.json()) as ListApplicationsResponse).applications;
    };
    const rows: ApplicationSummary[] = await listed();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.route).toMatchObject({ engagement_id: other });
    expect((await listed({ routed_engagement_id: other })).length).toBe(1);
    expect(await listed({ routed_engagement_id: real.id })).toEqual([]);
    await expectProblem(
      await consumer.api.listApplications(consumer.owner, {
        opening_number: opening.opening_number,
        view: "applicants",
        routed_engagement_id: other,
      }),
      400,
      problems.validation,
      ["routed_engagement_id"],
    );
    await expectProblem(
      await consumer.api.listApplications(consumer.owner, {
        opening_number: opening.opening_number,
        view: "candidates",
        routed_engagement_id: "x",
      }),
      400,
      problems.validation,
      ["routed_engagement_id"],
    );
    expect(
      await detailOf(
        consumer.api,
        consumer.owner,
        opening.opening_number,
        waiting.application_number,
      ),
    ).toMatchObject({
      route: { engagement_id: other },
    });

    // Back in-house.
    const inHouse = await routed(world, toOther);
    expect(inHouse.route).toBeUndefined();
    expect(inHouse.version).toBe(5);
    expect(routeRows(world, inHouse)).toBe(0);
    await expectProblem(
      await route(world, inHouse),
      409,
      routing.applicationState,
    );

    // A candidacy that has not been shortlisted, or whose stage has no
    // assignment, cannot be routed.
    const submitted = await seedApplicationNumber(
      world.hiring,
      opening.opening_number,
    );
    await expectProblem(
      await consumer.api.routeApplication(consumer.owner, {
        opening_number: opening.opening_number,
        application_number: submitted,
        version: 1,
        engagement_id: real.id,
      }),
      409,
      routing.applicationState,
    );
    await expectProblem(
      await consumer.api.routeApplication(consumer.owner, {
        opening_number: opening.opening_number,
        application_number: 9999,
        version: 1,
      }),
      404,
      routing.applicationNotFound,
    );
    const atScreen = await candidate(world, screen);
    await expectProblem(
      await route(world, atScreen, real.id),
      404,
      routing.assignmentNotFound,
    );
  });
});

test("provider access ends when a candidacy leaves its stage or the pipeline, or the assignment or engagement ends", async ({
  request,
}) => {
  test.setTimeout(180_000);
  await withWorld(request, async (world) => {
    const { pair, opening, panel, final } = world;
    const { consumer, provider } = pair;
    const live = await activate(pair, "interviewing");
    await assign(world, live.id, panel);
    await assign(world, live.id, final);

    // Moving to another stage ends the route.
    const moving = await routed(world, await candidate(world, panel), live.id);
    expect(routeRows(world, moving)).toBe(1);
    const moved = await consumer.api.moveApplicationStage(consumer.owner, {
      opening_number: opening.opening_number,
      application_number: moving.application_number,
      version: moving.version,
      stage_id: final.id,
    });
    expect(moved.status(), await moved.text()).toBe(200);
    const afterMove = (await moved.json()) as ApplicationDetail;
    expect(afterMove.route).toBeUndefined();
    expect(routeRows(world, afterMove)).toBe(0);
    // The route can be made again at the new stage.
    expect((await routed(world, afterMove, live.id)).route).toMatchObject({
      engagement_id: live.id,
    });

    // Leaving the pipeline ends it.
    const leaving = await routed(world, await candidate(world, panel), live.id);
    const left = await consumer.api.markApplicationNotProgressing(
      consumer.owner,
      {
        opening_number: opening.opening_number,
        application_number: leaving.application_number,
        version: leaving.version,
      },
    );
    expect(left.status(), await left.text()).toBe(200);
    expect(routeRows(world, leaving)).toBe(0);

    // Unassigning ends the routes through the assignment.
    const unassigning = await routed(
      world,
      await candidate(world, panel),
      live.id,
    );
    expect(
      (
        await consumer.api.unassignOpeningProvider(consumer.owner, {
          opening_number: opening.opening_number,
          engagement_id: live.id,
          stage_id: panel.id,
        })
      ).status(),
    ).toBe(200);
    expect(routeRows(world, unassigning)).toBe(0);
    expect(
      (
        await detailOf(
          consumer.api,
          consumer.owner,
          opening.opening_number,
          unassigning.application_number,
        )
      ).route,
    ).toBeUndefined();
    await assign(world, live.id, panel);

    // Ending the engagement removes every assignment and route, whichever
    // party ends it.
    for (const endedBy of ["consumer", "provider"] as const) {
      const engagement =
        endedBy === "consumer" ? live : await activate(pair, "interviewing");
      if (endedBy === "provider") {
        await assign(world, engagement.id, panel);
      }
      const waiting = await routed(
        world,
        await candidate(world, panel),
        engagement.id,
      );
      expect(routeRows(world, waiting)).toBe(1);
      if (endedBy === "consumer") {
        const ended = await consumer.api.endEngagement(consumer.owner, {
          engagement_id: engagement.id,
          version: engagement.version,
        });
        expect(ended.status(), await ended.text()).toBe(200);
      } else {
        const view = await asProvider(pair, engagement.id, engagement.version);
        const ended = await provider.api.endClientEngagement(provider.owner, {
          engagement_id: engagement.id,
          version: view.version,
        });
        expect(ended.status(), await ended.text()).toBe(200);
      }
      expect(routeRows(world, waiting)).toBe(0);
      const providers = (await (
        await consumer.api.getOpeningProviders(consumer.owner, {
          opening_number: opening.opening_number,
        })
      ).json()) as OpeningProviders;
      expect(
        providers.stages.flatMap((item) =>
          item.assignments.filter(
            (assignment) => assignment.engagement_id === engagement.id,
          ),
        ),
      ).toEqual([]);
      expect((await asConsumer(pair, engagement.id)).state).toBe("ended");
    }
  });
});

test("routing to a background-check provider copies the Listing's consent disclosure", async ({
  request,
}) => {
  test.setTimeout(180_000);
  await withWorld(request, async (world) => {
    const { pair, check } = world;
    const { consumer, provider } = pair;
    const engagement = await activate(pair, "background_check");
    await assign(world, engagement.id, check);

    const stored = (application: ApplicationDetail) =>
      orgSQL(
        `SELECT consent_disclosure || '|' || array_to_string(listing_check_types, ',')
         FROM vetchium.org_application_routes
         WHERE org_application_id = (
           SELECT a.org_application_id FROM vetchium.org_applications AS a
           JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
           WHERE o.org_did = (SELECT org_did FROM vetchium.org_domains
             WHERE domain = '${consumer.org.domain}')
             AND o.opening_number = ${world.opening.opening_number}
             AND a.application_number = ${application.application_number})`,
      );

    const first = await routed(
      world,
      await candidate(world, check),
      engagement.id,
    );
    expect(first.route).toMatchObject({ capability: "background_check" });
    expect(stored(first)).toBe(
      "We verify what you tell us.|identity,education",
    );

    // The provider unlists the Listing and rewrites its disclosure. The
    // engagement continues, so the next route copies the current text.
    const listings = (await (
      await provider.api.listListings(provider.owner)
    ).json()) as { listings: Listing[] };
    const listing = listings.listings.find(
      (item) => item.capability === "background_check",
    );
    if (listing === undefined) throw new Error("no background-check Listing");
    const unlisted = await provider.api.unlistListing(provider.owner, {
      capability: "background_check",
      version: listing.version,
    });
    expect(unlisted.status(), await unlisted.text()).toBe(200);
    const edited = await provider.api.updateListing(provider.owner, {
      capability: "background_check",
      version: ((await unlisted.json()) as Listing).version,
      headline: listing.headline,
      description: listing.description,
      service: listing.service,
      languages: listing.languages,
      check_types: ["criminal"],
      consent_disclosure: "Rewritten disclosure",
    });
    expect(edited.status(), await edited.text()).toBe(200);

    const second = await routed(
      world,
      await candidate(world, check),
      engagement.id,
    );
    expect(stored(second)).toBe("Rewritten disclosure|criminal");
    // The first candidacy keeps the text its applicant was shown.
    expect(stored(first)).toBe(
      "We verify what you tell us.|identity,education",
    );

    // A provider tenant that does not answer refuses the route.
    const third = await candidate(world, check);
    const providerDID = orgDID(provider.org.domain, "deu");
    setOrgHome(providerDID, "gone");
    try {
      await expectProblem(
        await route(world, third, engagement.id),
        503,
        problems.unavailable,
      );
    } finally {
      setOrgHome(providerDID, "deu");
    }
    expect((await routed(world, third, engagement.id)).route).toBeDefined();
  });
});

test("the engagement Listing read serves only the consumer an engagement names", async ({
  request,
  apiCoverage,
}) => {
  test.setTimeout(120_000);
  await withPair(
    request,
    { capabilities: ["background_check"] },
    async (pair) => {
      const { consumer, provider } = pair;
      const engagement = await activate(pair, "background_check");
      const consumerDID = orgDID(consumer.org.domain, "sgp");
      const body = {
        engagement_id: engagement.id,
        consumer_org_did: consumerDID,
      };
      const relay = (
        tenant: string,
        request: unknown,
        authorization?: string | null,
      ) =>
        meshRelayRequest(
          "sgp",
          "/mesh/listings/engagement-listing",
          { tenant, request },
          apiCoverage,
          authorization === undefined ? {} : { authorization },
        );
      const found = relay("deu", body);
      expect(found.status, JSON.stringify(found.body)).toBe(200);
      expect(found.body).toEqual({
        capability: "background_check",
        check_types: ["identity", "education"],
        consent_disclosure: "We verify what you tell us.",
      });
      for (const [label, request] of [
        ["another engagement", { ...body, engagement_id: randomUUID() }],
        [
          "another consumer",
          { ...body, consumer_org_did: orgDID(provider.org.domain, "deu") },
        ],
      ] as const) {
        const refused = relay("deu", request);
        expect(refused.status, label).toBe(404);
        expect(refused.body, label).toMatchObject({
          type: routing.engagementNotFound,
        });
      }
      const unreachable = relay("gone", body);
      expect(unreachable.status).toBe(503);
      expect(unreachable.body).toMatchObject({ type: problems.unavailable });
      expect(relay("deu", body, null).status).toBe(401);
      expect(relay("deu", { engagement_id: "x" }).status).toBe(400);
      expect(
        meshRelayRequest(
          "sgp",
          "/mesh/listings/engagement-listing",
          {},
          apiCoverage,
          { rawBody: "{" },
        ).status,
      ).toBe(400);

      const peer = (from: "sgp" | "usa1", request: unknown = body) =>
        meshPeerRequest(from, "deu", request, apiCoverage, {
          path: "/api/mesh/listings/engagement-listing",
        });
      const direct = peer("sgp");
      expect(direct.status, JSON.stringify(direct.body)).toBe(200);
      expect(direct.body).toMatchObject({ capability: "background_check" });
      // A tenant that does not home the consumer is told nothing.
      const stranger = peer("usa1");
      expect(stranger.status, JSON.stringify(stranger.body)).toBe(404);
      expect(stranger.body).toMatchObject({ type: routing.engagementNotFound });
      expect(peer("sgp", { engagement_id: "x" }).status).toBe(400);
      expect(
        meshPeerRequest("sgp", "deu", {}, apiCoverage, {
          path: "/api/mesh/listings/engagement-listing",
          rawBody: "{",
        }).status,
      ).toBe(400);
      expect(
        meshPeerRequest("sgp", "deu", body, [], {
          path: "/api/mesh/listings/engagement-listing",
          withoutCertificate: true,
        }).status,
      ).toBe(0);
      const health = meshPeerRequest("sgp", "deu", body, apiCoverage, {
        path: "/api/mesh/listings/engagement-listing",
        certificate: "health",
      });
      expect(health.status, JSON.stringify(health.body)).toBe(401);
      for (const value of [found.body, direct.body]) {
        expect(JSON.stringify(value)).not.toMatch(
          /org_did|email|version|session|credential|password/,
        );
      }
    },
  );
});

test("assignment and routing routes authenticate, authorize, validate, and refuse suspended Orgs", async ({
  request,
}) => {
  test.setTimeout(180_000);
  await withPair(request, { capabilities: ["interviewing"] }, async (pair) => {
    const { consumer } = pair;
    const viewerEmail = inviteeAddress(consumer.org.domain, "viewer");
    const viewer = await addOrgMember(
      consumer.api,
      consumer.owner,
      consumer.org.domain,
      viewerEmail,
      [],
    );
    const hiring: HiringOrg = {
      request,
      tenant: consumer.tenant,
      api: consumer.api,
      owner: consumer.owner,
      domain: consumer.org.domain,
      did: orgDID(consumer.org.domain, consumer.tenant),
      applicants: [],
    };
    try {
      const { opening, stages } = await publishedOpening(
        consumer.api,
        consumer.owner,
        consumer.org,
        { team: [viewerEmail] },
      );
      const world = {
        request,
        pair,
        others: [],
        hiring,
        opening,
        screen: stageOf(stages, 0),
        panel: stageOf(stages, 1),
        final: stageOf(stages, 2),
        assess: stageOf(stages, 2),
        check: stageOf(stages, 2),
      } satisfies World;
      const engagement = await activate(pair, "interviewing");
      await assign(world, engagement.id, world.panel);
      const waiting = await candidate(world, world.panel);
      const number = opening.opening_number;
      const target = {
        opening_number: number,
        engagement_id: engagement.id,
        stage_id: world.panel.id,
      };
      const routeBody = {
        opening_number: number,
        application_number: waiting.application_number,
        version: waiting.version,
        engagement_id: engagement.id,
      };
      const routes = [
        {
          path: "/get-opening-providers",
          body: { opening_number: number },
          write: false,
        },
        { path: "/assign-opening-provider", body: target, write: true },
        { path: "/unassign-opening-provider", body: target, write: true },
        { path: "/route-application", body: routeBody, write: true },
      ];
      const keyed = (write: boolean) =>
        write ? { idempotencyKey: orgsIdempotencyKey() } : {};
      for (const item of routes) {
        await expectProblem(
          await consumer.api.post(item.path, item.body, keyed(item.write)),
          401,
          problems.authentication,
        );
        await expectProblem(
          await consumer.api.postRaw(item.path, "{", {
            token: consumer.owner,
            ...keyed(item.write),
          }),
          400,
          problems.invalidJSON,
        );
        if (item.write) {
          expect(
            (
              await consumer.api.post(item.path, item.body, {
                token: consumer.owner,
              })
            ).status(),
            item.path,
          ).toBe(400);
        }
      }
      for (const [path, bad] of [
        ["/get-opening-providers", { opening_number: 0 }],
        ["/assign-opening-provider", { ...target, engagement_id: "x" }],
        ["/assign-opening-provider", { ...target, stage_id: "x" }],
        ["/unassign-opening-provider", { ...target, opening_number: 0 }],
        ["/route-application", { ...routeBody, version: 0 }],
        ["/route-application", { ...routeBody, engagement_id: "x" }],
      ] as const) {
        await expectProblem(
          await consumer.api.marketplaceWriteRaw(path, consumer.owner, bad),
          400,
          problems.validation,
        );
      }

      // Assignment needs org:manage_providers; routing needs the rights to
      // act on the candidacy, which a team member who only reads lacks.
      const plain = await addOrgMember(
        consumer.api,
        consumer.owner,
        consumer.org.domain,
        inviteeAddress(consumer.org.domain, "plain"),
        [],
      );
      const buyer = await addOrgMember(
        consumer.api,
        consumer.owner,
        consumer.org.domain,
        inviteeAddress(consumer.org.domain, "buyer"),
        ["org:manage_providers"],
      );
      const candidates = await addOrgMember(
        consumer.api,
        consumer.owner,
        consumer.org.domain,
        inviteeAddress(consumer.org.domain, "candidates"),
        ["org:manage_candidacies"],
      );
      const attempt = (item: (typeof routes)[number], token: string) =>
        consumer.api.post(item.path, item.body, {
          token,
          ...keyed(item.write),
        });
      for (const item of routes.slice(0, 3)) {
        for (const token of [plain.token, viewer.token, candidates.token]) {
          await expectProblem(
            await attempt(item, token),
            403,
            problems.permission,
          );
        }
      }
      expect((await attempt(routes[0] as never, buyer.token)).status()).toBe(
        200,
      );
      // The viewer reads the Opening's applications as a team member but
      // may not act on them; a stranger to the Opening cannot see them.
      await expectProblem(
        await attempt(routes[3] as never, viewer.token),
        403,
        problems.permission,
      );
      await expectProblem(
        await attempt(routes[3] as never, plain.token),
        404,
        routing.applicationNotFound,
      );
      const byCandidacies = await attempt(routes[3] as never, candidates.token);
      expect(byCandidacies.status(), await byCandidacies.text()).toBe(200);

      orgSQL(`UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
          WHERE org_did = (SELECT org_did FROM vetchium.org_domains
            WHERE domain = '${consumer.org.domain}')`);
      for (const item of routes) {
        await expectProblem(
          await attempt(item, consumer.owner),
          403,
          problems.suspended,
        );
      }
    } finally {
      cleanupApplicants(hiring);
      cleanupOutbox(consumer.org.domain);
    }
  });
});
