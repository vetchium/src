import { expect } from "@playwright/test";
import type { ApplicationDetail } from "typespec/orgs/applications/applications";
import type { PipelineStage } from "typespec/orgs/hiring/pipelines";
import type { OpeningProviders } from "typespec/orgs/marketplace/assignments";
import type { Capability } from "typespec/orgs/marketplace/capabilities";
import type { OrgOpening } from "typespec/orgs/openings/types";
import type { TestTenant } from "./admin-db.ts";
import { orgSQL, orgsIdempotencyKey } from "./orgs-api.ts";
import {
  cleanupOutbox,
  publishedOpening,
  seedApplication,
  shortlist,
  stageOf,
} from "./orgs-applications.ts";
import { type Pair, withPair } from "./orgs-marketplace.ts";

// A consumer with an Opening whose pipeline has a stage of every kind and a
// provider with a Listing for each Capability, for the specs of routing and
// of provider work.

export const allCapabilities: Capability[] = [
  "sourcing",
  "interviewing",
  "assessment",
  "background_check",
];

export interface World {
  pair: Pair;
  opening: OrgOpening;
  screen: PipelineStage;
  panel: PipelineStage;
  final: PipelineStage;
  assess: PipelineStage;
  check: PipelineStage;
}

/**
 * A consumer with a published Opening whose pipeline has a stage of every
 * kind, and a provider with a Listing for each Capability.
 */
export async function withWorld(
  request: Parameters<typeof withPair>[0],
  body: (world: World) => Promise<void>,
  options: {
    team?: string[];
    tenants?: { consumer?: TestTenant; provider?: TestTenant };
  } = {},
): Promise<void> {
  await withPair(
    request,
    {
      ...options.tenants,
      capabilities: allCapabilities,
    },
    async (pair) => {
      const { consumer } = pair;
      try {
        const { opening, stages } = await publishedOpening(
          consumer.api,
          consumer.owner,
          consumer.org,
          {
            ...(options.team === undefined ? {} : { team: options.team }),
            stages: [
              { name: "Screen", kind: "review" },
              { name: "Panel", kind: "interview" },
              { name: "Final", kind: "interview" },
              { name: "Assess", kind: "assessment" },
              { name: "Check", kind: "background_check" },
            ],
          },
        );
        await body({
          pair,
          opening,
          screen: stageOf(stages, 0),
          panel: stageOf(stages, 1),
          final: stageOf(stages, 2),
          assess: stageOf(stages, 3),
          check: stageOf(stages, 4),
        });
      } finally {
        cleanupOutbox(consumer.org.domain, consumer.tenant);
      }
    },
  );
}

export async function assign(
  { pair, opening }: World,
  engagementID: string,
  stage?: PipelineStage,
): Promise<OpeningProviders> {
  const { consumer } = pair;
  const response = await consumer.api.assignOpeningProvider(consumer.owner, {
    opening_number: opening.opening_number,
    engagement_id: engagementID,
    ...(stage === undefined ? {} : { stage_id: stage.id }),
  });
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as OpeningProviders;
}

/** A candidacy waiting at `stage`, as a Hub applicant would have left it. */
export async function candidate(
  world: World,
  stage: PipelineStage,
  name?: string,
): Promise<ApplicationDetail> {
  const { consumer } = world.pair;
  const number = seedApplication(
    consumer.org.domain,
    world.opening.opening_number,
    name === undefined ? {} : { name },
  );
  return shortlist(
    consumer.api,
    consumer.owner,
    world.opening.opening_number,
    number,
    stage,
  );
}

export async function route(
  world: World,
  application: ApplicationDetail,
  engagementID?: string,
  token = world.pair.consumer.owner,
  key = orgsIdempotencyKey(),
) {
  return world.pair.consumer.api.routeApplication(
    token,
    {
      opening_number: world.opening.opening_number,
      application_number: application.application_number,
      version: application.version,
      ...(engagementID === undefined ? {} : { engagement_id: engagementID }),
    },
    key,
  );
}

export async function routed(
  world: World,
  application: ApplicationDetail,
  engagementID?: string,
): Promise<ApplicationDetail> {
  const response = await route(world, application, engagementID);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as ApplicationDetail;
}

/**
 * Active engagements with providers that exist only as rows, for caps and
 * second providers: the consumer's tenant never contacts them.
 */
export function seedEngagements(
  world: World,
  capability: Capability,
  count: number,
): string[] {
  const { consumer } = world.pair;
  const ids = orgSQL(
    `WITH inserted AS (
       INSERT INTO vetchium.org_engagements (
         engagement_id, consumer_org_did, provider_org_did, provider_domain,
         provider_display_name, capability_oid, engagement_state, expires_at,
         decided_at
       )
       SELECT gen_random_uuid(),
         (SELECT org_did FROM vetchium.org_domains
          WHERE domain = '${consumer.org.domain}'),
         gen_random_uuid(), 'fake-' || n || '.example.test', 'Fake ' || n,
         '${capability}', 'active', now() + interval '30 days', now()
       FROM generate_series(1, ${count}) AS n
       RETURNING engagement_id
     )
     SELECT string_agg(engagement_id::text, ',') FROM inserted`,
  );
  return ids.split(",");
}
