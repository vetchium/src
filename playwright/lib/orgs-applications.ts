import { expect } from "@playwright/test";
import type {
  ApplicationQuestion,
  OpeningContent,
} from "typespec/common/openings";
import type { ApplicationDetail } from "typespec/orgs/applications/applications";
import type {
  FeedbackCriterion,
  PipelineStage,
} from "typespec/orgs/hiring/pipelines";
import type { OpeningPipeline } from "typespec/orgs/openings/pipeline";
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
    questions?: ApplicationQuestion[];
  } = {},
): Promise<{ opening: OrgOpening; stages: PipelineStage[] }> {
  const created = await api.createOpening(owner, {
    content: {
      ...openingContent(options.title ?? "Engineer", options.positions ?? 1),
      ...(options.questions ? { questions: options.questions } : {}),
    },
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
  const stages = applicationStages(
    ((await replaced.json()) as { stages: PipelineStage[] }).stages,
  );
  return { opening: await reread(api, owner, opening), stages };
}

/** Pipeline stages as application reads show them: without the feedback form
 * and counts the pipeline read adds. */
export function applicationStages(stages: PipelineStage[]): PipelineStage[] {
  return stages.map(({ id, name, kind }) => ({ id, name, kind }));
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

/** Replaces the feedback form of the stage at `index`, keeping the rest. */
export async function setStageForm(
  api: Api,
  owner: string,
  opening: number,
  index: number,
  form: FeedbackCriterion[],
): Promise<FeedbackCriterion[]> {
  const current = await api.getOpeningPipeline(owner, {
    opening_number: opening,
  });
  const pipeline = (await current.json()) as OpeningPipeline;
  const replaced = await api.replaceOpeningPipeline(owner, {
    opening_number: opening,
    version: pipeline.version,
    stages: pipeline.stages.map((stage, position) => ({
      id: stage.id,
      name: stage.name,
      kind: stage.kind,
      ...(position === index
        ? { feedback_form: form }
        : stage.feedback_form && { feedback_form: stage.feedback_form }),
    })),
  });
  expect(replaced.status(), await replaced.text()).toBe(200);
  return (
    ((await replaced.json()) as OpeningPipeline).stages[index]?.feedback_form ??
    []
  );
}
