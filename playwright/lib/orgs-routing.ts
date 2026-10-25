import { expect } from "@playwright/test";
import type { ApplicationDetail } from "typespec/orgs/applications/applications";
import type { PipelineStage } from "typespec/orgs/hiring/pipelines";
import type { OpeningProviders } from "typespec/orgs/marketplace/assignments";
import type { Capability } from "typespec/orgs/marketplace/capabilities";
import type { OrgOpening } from "typespec/orgs/openings/types";
import type { TestTenant } from "./admin-db.ts";
import {
  cleanupApplicants,
  type HiringOrg,
  seedApplicationNumber,
} from "./hiring-seed.ts";
import { orgDID, orgsIdempotencyKey } from "./orgs-api.ts";
import {
  cleanupOutbox,
  publishedOpening,
  shortlist,
  stageOf,
} from "./orgs-applications.ts";
import {
  activate,
  listedProvider,
  type Pair,
  type Provider,
  removeProvider,
  withPair,
} from "./orgs-marketplace.ts";

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
  request: Parameters<typeof withPair>[0];
  pair: Pair;
  /** Providers of seedEngagements, removed with the world. */
  others: Provider[];
  /** The consumer as seeding sees it; its applicants go with the world. */
  hiring: HiringOrg;
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
      const others: Provider[] = [];
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
          request,
          pair,
          others,
          hiring,
          opening,
          screen: stageOf(stages, 0),
          panel: stageOf(stages, 1),
          final: stageOf(stages, 2),
          assess: stageOf(stages, 3),
          check: stageOf(stages, 4),
        });
      } finally {
        cleanupApplicants(hiring);
        for (const other of others) await removeProvider(other);
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

/** A candidacy waiting at `stage`, from a Hub applicant's application. */
export async function candidate(
  world: World,
  stage: PipelineStage,
  name?: string,
  referralAgencyDomain?: string,
): Promise<ApplicationDetail> {
  const { consumer } = world.pair;
  const number = await seedApplicationNumber(
    world.hiring,
    world.opening.opening_number,
    {
      ...(name !== undefined && { name }),
      ...(referralAgencyDomain !== undefined && { referralAgencyDomain }),
    },
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
 * Active engagements of capability with providers of their own, each
 * proposed by the consumer and accepted by its provider, for caps and second
 * providers. The providers live in the consumer's tenant.
 */
export async function seedEngagements(
  world: World,
  capability: Capability,
  count: number,
): Promise<string[]> {
  const { consumer } = world.pair;
  return Promise.all(
    Array.from({ length: count }, async () => {
      const provider = await listedProvider(
        world.request,
        capability,
        consumer.tenant,
      );
      world.others.push(provider);
      return (await activate({ consumer, provider }, capability)).id;
    }),
  );
}
