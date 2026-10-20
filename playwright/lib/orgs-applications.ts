import { expect } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type {
  ApplicationDetail,
  ApplicationState,
} from "typespec/orgs/applications/applications";
import type { PipelineStage } from "typespec/orgs/hiring/pipelines";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { sqlLiteral, type TestTenant } from "./admin-db.ts";
import { type OrgsAPI, orgDID, orgSQL, type SignedUpOrg } from "./orgs-api.ts";

type Api = OrgsAPI;

/** Removes the outbox events the Org's applications queued for their
 * (fixture) applicants, which nothing delivers to, before the Org goes. */
export function cleanupOutbox(
  domain: string,
  tenant: TestTenant = "sgp",
): void {
  const did = orgDID(domain, tenant);
  if (did === "") return;
  orgSQL(
    `DELETE FROM vetchium.federation_outbox
     WHERE aggregate_type = 'org_application'
       AND aggregate_id LIKE ${sqlLiteral(`${did}:%`)}`,
    tenant,
  );
}

export const orgDIDSQL = (domain: string) =>
  `(SELECT org_did FROM vetchium.org_domains WHERE domain = ${sqlLiteral(domain)})`;

export interface SeedOptions {
  name?: string;
  state?: ApplicationState;
  stageId?: string;
  offerExtendedDaysAgo?: number;
  joinedOn?: string;
  joinedRecordedDaysAgo?: number;
  separatedOn?: string;
  separatedRecordedDaysAgo?: number;
}

/**
 * Inserts an application the way hub-apply would have (the applicant is a
 * fixture nobody can reach), in any state, and returns its number.
 */
export function seedApplication(
  domain: string,
  openingNumber: number,
  options: SeedOptions = {},
): number {
  const state = options.state ?? "submitted";
  const stage = options.stageId ? sqlLiteral(options.stageId) : "NULL";
  const offer =
    options.offerExtendedDaysAgo === undefined
      ? "NULL"
      : `now() - interval '${options.offerExtendedDaysAgo} days'`;
  const joinedOn = options.joinedOn ? sqlLiteral(options.joinedOn) : "NULL";
  const joinedRecorded =
    options.joinedOn === undefined
      ? "NULL"
      : `now() - interval '${options.joinedRecordedDaysAgo ?? 0} days'`;
  const separatedOn = options.separatedOn
    ? sqlLiteral(options.separatedOn)
    : "NULL";
  const separatedRecorded =
    options.separatedOn === undefined
      ? "NULL"
      : `now() - interval '${options.separatedRecordedDaysAgo ?? 0} days'`;
  return Number(
    orgSQL(`
    WITH o AS (
      SELECT org_opening_id, org_did, next_application_number
      FROM vetchium.org_openings
      WHERE org_did = ${orgDIDSQL(domain)} AND opening_number = ${openingNumber}
    ), applicant AS (
      INSERT INTO vetchium.org_applicants
        (org_applicant_id, org_did, applicant_kind, hub_user_did)
      SELECT gen_random_uuid(), o.org_did, 'hub_user',
        overlay(gen_random_uuid()::text placing '7' from 15)::uuid
      FROM o RETURNING org_applicant_id
    ), application AS (
      INSERT INTO vetchium.org_applications (
        org_application_id, org_opening_id, application_number,
        org_applicant_id, application_state, snapshot, current_stage_id,
        offer_extended_at, joined_on, joined_recorded_at, separated_on,
        separated_recorded_at
      )
      SELECT gen_random_uuid(), o.org_opening_id, o.next_application_number,
        applicant.org_applicant_id, ${sqlLiteral(state)},
        jsonb_build_object('display_name',
          ${sqlLiteral(options.name ?? "Ada Lovelace")}::text,
          'handle', 'abcd1234-0123456789a'::text,
          'resident_country', 'GB'::text,
          'biography', 'Wrote the first program'::text,
          'websites', '[]'::jsonb, 'work_experiences', '[]'::jsonb,
          'certifications', '[]'::jsonb, 'language_abilities', '[]'::jsonb,
          'educational_qualifications', '[]'::jsonb),
        ${stage}::uuid, ${offer}, ${joinedOn}::date, ${joinedRecorded},
        ${separatedOn}::date, ${separatedRecorded}
      FROM o, applicant
      RETURNING org_application_id, application_number
    ), counter AS (
      UPDATE vetchium.org_openings
      SET next_application_number = next_application_number + 1
      WHERE org_opening_id IN (SELECT org_opening_id FROM o)
      RETURNING org_opening_id
    ), history AS (
      INSERT INTO vetchium.org_application_history (
        org_application_history_id, org_application_id, action, actor_kind,
        application_state, application_version
      )
      SELECT gen_random_uuid(), org_application_id, 'applied', 'applicant',
        'submitted', 1
      FROM application RETURNING 1
    )
    SELECT application_number FROM application
      WHERE (SELECT count(*) FROM counter) = 1
        AND (SELECT count(*) FROM history) = 1`),
  );
}

export function openingContent(title: string, positions = 1): OpeningContent {
  return {
    title,
    description: "Build reliable services",
    language: "en",
    employing_country: "SG",
    work_arrangement: "hybrid",
    employment_type: "full_time",
    positions,
  };
}

/** A published Opening with, by default, the pipeline Screen (review), Panel
 * and Final (interview). The owner is its hiring manager and recruiter. */
export async function publishedOpening(
  api: Api,
  owner: string,
  org: SignedUpOrg,
  options: {
    title?: string;
    positions?: number;
    team?: string[];
    stages?: Array<{ name: string; kind: PipelineStage["kind"] }>;
  } = {},
): Promise<{ opening: OrgOpening; stages: PipelineStage[] }> {
  const created = await api.createOpening(owner, {
    content: openingContent(
      options.title ?? "Engineer",
      options.positions ?? 1,
    ),
    hiring_manager_email: org.emailAddress,
    recruiter_email: org.emailAddress,
    team_member_emails: options.team ?? [],
  });
  expect(created.status(), await created.text()).toBe(201);
  const draft = (await created.json()) as OrgOpening;
  const published = await api.requestOpeningChange(owner, {
    opening_number: draft.opening_number,
    version: draft.version,
    kind: "publish",
  });
  expect(published.status(), await published.text()).toBe(200);
  const opening = (await published.json()) as OrgOpening;
  const replaced = await api.replaceOpeningPipeline(owner, {
    opening_number: opening.opening_number,
    version: opening.version,
    stages: options.stages ?? [
      { name: "Screen", kind: "review" },
      { name: "Panel", kind: "interview" },
      { name: "Final", kind: "interview" },
    ],
  });
  expect(replaced.status(), await replaced.text()).toBe(200);
  const stages = ((await replaced.json()) as { stages: PipelineStage[] })
    .stages;
  return { opening: await reread(api, owner, opening), stages };
}

export async function reread(
  api: Api,
  token: string,
  opening: OrgOpening,
): Promise<OrgOpening> {
  const response = await api.getOpening(token, {
    opening_number: opening.opening_number,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as OrgOpening;
}

/**
 * Inserts `count` submitted applications named `<prefix> 1` to `<prefix> N`
 * in one statement, for tests that page through a list.
 */
export function seedSubmittedBatch(
  domain: string,
  openingNumber: number,
  count: number,
  prefix: string,
): void {
  orgSQL(`
    WITH o AS (
      SELECT org_opening_id, org_did, next_application_number
      FROM vetchium.org_openings
      WHERE org_did = ${orgDIDSQL(domain)} AND opening_number = ${openingNumber}
    ), series AS (
      SELECT n FROM generate_series(1, ${count}) AS n
    ), applicant AS (
      INSERT INTO vetchium.org_applicants
        (org_applicant_id, org_did, applicant_kind, hub_user_did)
      SELECT gen_random_uuid(), o.org_did, 'hub_user',
        overlay(gen_random_uuid()::text placing '7' from 15)::uuid
      FROM o, series RETURNING org_applicant_id
    ), numbered AS (
      SELECT org_applicant_id,
        row_number() OVER () AS n FROM applicant
    ), application AS (
      INSERT INTO vetchium.org_applications (
        org_application_id, org_opening_id, application_number,
        org_applicant_id, application_state, snapshot
      )
      SELECT gen_random_uuid(), o.org_opening_id,
        o.next_application_number + numbered.n - 1,
        numbered.org_applicant_id, 'submitted',
        jsonb_build_object('display_name',
          ${sqlLiteral(prefix)} || ' ' || numbered.n,
          'handle', 'abcd1234-0123456789a'::text,
          'resident_country', 'GB'::text,
          'websites', '[]'::jsonb, 'work_experiences', '[]'::jsonb,
          'certifications', '[]'::jsonb, 'language_abilities', '[]'::jsonb,
          'educational_qualifications', '[]'::jsonb)
      FROM o, numbered
      RETURNING org_application_id
    ), counter AS (
      UPDATE vetchium.org_openings
      SET next_application_number = next_application_number + ${count}
      WHERE org_opening_id IN (SELECT org_opening_id FROM o)
      RETURNING org_opening_id
    ), history AS (
      INSERT INTO vetchium.org_application_history (
        org_application_history_id, org_application_id, action, actor_kind,
        application_state, application_version
      )
      SELECT gen_random_uuid(), org_application_id, 'applied', 'applicant',
        'submitted', 1
      FROM application RETURNING 1
    )
    SELECT count(*) FROM history, counter`);
}

/** The stage at `index`, which the test knows its pipeline has. */
export function stageOf(stages: PipelineStage[], index: number): PipelineStage {
  const stage = stages[index];
  if (!stage) throw new Error(`expected stage ${index}`);
  return stage;
}

/** The UTC calendar date `days` from today. */
export function utcDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Shortlists a submitted application (version 1) to `stage`. */
export async function shortlist(
  api: Api,
  token: string,
  opening: number,
  application: number,
  stage: PipelineStage,
): Promise<ApplicationDetail> {
  const response = await api.shortlistApplication(token, {
    opening_number: opening,
    application_number: application,
    version: 1,
    stage_id: stage.id,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as ApplicationDetail;
}

export async function detailOf(
  api: Api,
  token: string,
  opening: number,
  application: number,
): Promise<ApplicationDetail> {
  const response = await api.getApplication(token, {
    opening_number: opening,
    application_number: application,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as ApplicationDetail;
}
