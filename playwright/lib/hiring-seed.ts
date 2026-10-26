import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import type {
  ApplicationDetail,
  ApplicationState,
} from "typespec/orgs/applications/applications";
import { sqlLiteral, sqlScalarForTenant, type TestTenant } from "./admin-db.ts";
import { hubIdempotencyKey } from "./hub-api.ts";
import {
  type Applicant,
  apply,
  cleanupApplicantsOf,
  seedApplicant,
} from "./hub-applicant.ts";
import type { OrgsAPI } from "./orgs-api.ts";
import { utcDate } from "./orgs-applications.ts";

// Applications are created the way they are in production: a Hub applicant
// applies through the Hub API, and the Org's own APIs and the applicant's
// answers bring the application to the state a test needs. SQL only moves
// recorded instants into the past, for rules about elapsed time.

/** What seeding needs of the Org whose Opening is applied to. Applicants it
 * creates are kept on `applicants` for cleanupApplicants. */
export interface HiringOrg {
  request: APIRequestContext;
  tenant: TestTenant;
  api: OrgsAPI;
  /** A session of a user who acts on the Opening's applications. */
  owner: string;
  domain: string;
  did: string;
  applicants: Applicant[];
}

export interface ApplicationOptions {
  /** The applicant's display name, which the snapshot records. */
  name?: string;
  /** Defaults to submitted. */
  state?: ApplicationState;
  /** The stage a candidacy is shortlisted to; required for every state that
   * passes through the pipeline. */
  stageId?: string;
  coverNote?: string;
  /** The agency the applicant names as referrer, by primary domain. */
  referralAgencyDomain?: string;
  /** Where the applicant's account lives; the Org's tenant by default. */
  applicantTenant?: TestTenant;
  /** Moves the offer's extension this many days into the past, so a
   * joining date that long ago is allowed. */
  offerExtendedDaysAgo?: number;
  joinedOn?: string;
  /** Moves the first recording of joined_on into the past. */
  joinedRecordedDaysAgo?: number;
  separatedOn?: string;
  separatedRecordedDaysAgo?: number;
}

export interface SeededApplication {
  number: number;
  /** The version the application has after seeding. */
  version: number;
  applicant: Applicant;
}

/** A distinct, minimal PDF the API accepts as an offer letter. */
export function offerLetter(note = randomUUID()): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${note}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`,
  );
}

const candidacies: ReadonlySet<ApplicationState> = new Set([
  "in_pipeline",
  "offered",
  "offer_accepted",
  "offer_declined",
  "joined",
  "did_not_join",
]);

/** Applies with a new applicant and walks the application to the state
 * options name. */
export async function seedApplication(
  org: HiringOrg,
  openingNumber: number,
  options: ApplicationOptions = {},
): Promise<SeededApplication> {
  const state = options.state ?? "submitted";
  const applicant = seedApplicant(
    org.request,
    options.applicantTenant ?? org.tenant,
    options.name,
  );
  org.applicants.push(applicant);
  const reference = await apply(
    applicant,
    org.domain,
    openingNumber,
    options.referralAgencyDomain,
    options.coverNote,
  );
  const number = reference.application_number;
  const target = { opening_number: openingNumber, application_number: number };
  const step = new Steps(org, openingNumber, number);

  if (candidacies.has(state) || options.stageId !== undefined) {
    if (options.stageId === undefined) {
      throw new Error(`seeding ${state} needs a stage`);
    }
    await step.byOrg((version) =>
      org.api.shortlistApplication(org.owner, {
        ...target,
        version,
        stage_id: options.stageId as string,
      }),
    );
  }
  if (
    state === "offered" ||
    state === "offer_accepted" ||
    state === "offer_declined" ||
    state === "joined" ||
    state === "did_not_join"
  ) {
    await serially(org, async () => {
      const uploaded = await org.api.uploadOfferLetter(
        org.owner,
        offerLetter(),
      );
      expect(uploaded.status(), await uploaded.text()).toBe(201);
      const { letter_id } = (await uploaded.json()) as { letter_id: string };
      await step.byOrg((version) =>
        org.api.extendApplicationOffer(org.owner, {
          ...target,
          version,
          letter_id,
          respond_within_days: 14,
        }),
      );
    });
    // A joining date may not precede the offer, so a past one needs the
    // offer extended at least that long ago.
    const offerDaysAgo =
      options.offerExtendedDaysAgo ??
      (options.joinedOn === undefined
        ? undefined
        : Math.max(0, daysAgo(options.joinedOn)) + 1);
    if (offerDaysAgo !== undefined) {
      age(org, "offer_extended_at", offerDaysAgo, openingNumber, number);
    }
  }
  if (state === "offer_declined") {
    await step.byApplicant((key) =>
      applicant.hub.declineApplicationOffer(
        { domain: org.domain, ...target, offer_number: 1 },
        { token: applicant.token, idempotencyKey: key },
      ),
    );
  }
  if (
    state === "offer_accepted" ||
    state === "joined" ||
    state === "did_not_join"
  ) {
    await step.byApplicant((key) =>
      applicant.hub.acceptApplicationOffer(
        { domain: org.domain, ...target, offer_number: 1 },
        { token: applicant.token, idempotencyKey: key },
      ),
    );
  }
  if (state === "joined") {
    await step.byOrg((version) =>
      org.api.recordApplicationJoined(org.owner, {
        ...target,
        version,
        joined_on: options.joinedOn ?? utcDate(0),
      }),
    );
    if (options.separatedOn !== undefined) {
      await step.byOrg((version) =>
        org.api.recordApplicationSeparated(org.owner, {
          ...target,
          version,
          separated_on: options.separatedOn as string,
        }),
      );
    }
    if (options.joinedRecordedDaysAgo !== undefined) {
      age(
        org,
        "joined_recorded_at",
        options.joinedRecordedDaysAgo,
        openingNumber,
        number,
      );
    }
    if (options.separatedRecordedDaysAgo !== undefined) {
      age(
        org,
        "separated_recorded_at",
        options.separatedRecordedDaysAgo,
        openingNumber,
        number,
      );
    }
  }
  if (state === "did_not_join") {
    await step.byOrg((version) =>
      org.api.recordApplicationDidNotJoin(org.owner, { ...target, version }),
    );
  }
  if (state === "not_progressing") {
    await step.byOrg((version) =>
      org.api.markApplicationNotProgressing(org.owner, {
        ...target,
        version,
      }),
    );
  }
  if (state === "withdrawn") {
    await step.byApplicant((key) =>
      applicant.hub.withdrawApplication(
        { domain: org.domain, ...target },
        { token: applicant.token, idempotencyKey: key },
      ),
    );
  }
  // A bare submission needs no Org session, which keeps long batches inside
  // the short session lifetime CI uses.
  return {
    number,
    version: step.wrote ? await step.version() : 1,
    applicant,
  };
}

// A user's next upload replaces the letter they uploaded before, so offers
// seeded in parallel for one Org upload and extend one at a time.
const offerQueues = new WeakMap<HiringOrg, Promise<unknown>>();

async function serially(
  org: HiringOrg,
  work: () => Promise<void>,
): Promise<void> {
  const previous = offerQueues.get(org) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  offerQueues.set(org, next);
  await next;
}

/** How many whole UTC days `date` (YYYY-MM-DD) lies before today. */
function daysAgo(date: string): number {
  const today = new Date(`${utcDate(0)}T00:00:00Z`).getTime();
  return Math.round(
    (today - new Date(`${date}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

/** seedApplication for a test that needs only the number. */
export async function seedApplicationNumber(
  org: HiringOrg,
  openingNumber: number,
  options: ApplicationOptions = {},
): Promise<number> {
  return (await seedApplication(org, openingNumber, options)).number;
}

/** Moves a terminal application `days` into the past, as if it had become
 * terminal then, so the retention job removes it (HP-RET-001). */
export function ageTerminalApplication(
  org: HiringOrg,
  openingNumber: number,
  applicationNumber: number,
  days: number,
): void {
  sqlScalarForTenant(
    org.tenant,
    `UPDATE vetchium.org_applications AS a
     SET created_at = now() - make_interval(days => ${Math.trunc(days) + 30}),
       updated_at = now() - make_interval(days => ${Math.trunc(days)})
     FROM vetchium.org_openings AS o
     WHERE o.org_opening_id = a.org_opening_id
       AND o.org_did = ${sqlLiteral(org.did)}::uuid
       AND o.opening_number = ${Math.trunc(openingNumber)}
       AND a.application_number = ${Math.trunc(applicationNumber)}`,
  );
}

/** Seeds `count` submitted applications named `<prefix> 1` to `<prefix> N`,
 * a few at a time. */
export async function seedSubmitted(
  org: HiringOrg,
  openingNumber: number,
  count: number,
  prefix: string,
): Promise<number[]> {
  const numbers: number[] = [];
  for (let start = 1; start <= count; start += 8) {
    const batch = Array.from(
      { length: Math.min(8, count - start + 1) },
      (_, index) => start + index,
    );
    numbers.push(
      ...(await Promise.all(
        batch.map((index) =>
          seedApplicationNumber(org, openingNumber, {
            name: `${prefix} ${index}`,
          }),
        ),
      )),
    );
  }
  return numbers;
}

/** Removes every applicant seeding created for the Org, with what their
 * applications left in either tenant. */
export function cleanupApplicants(org: HiringOrg): void {
  cleanupApplicantsOf(org.applicants.splice(0), [
    { tenant: org.tenant, did: org.did },
  ]);
}

class Steps {
  wrote = false;

  constructor(
    private readonly org: HiringOrg,
    private readonly opening: number,
    private readonly number: number,
  ) {}

  async version(): Promise<number> {
    const response = await this.org.api.getApplication(this.org.owner, {
      opening_number: this.opening,
      application_number: this.number,
    });
    expect(response.status(), await response.text()).toBe(200);
    return ((await response.json()) as ApplicationDetail).version;
  }

  async byOrg(
    write: (
      version: number,
    ) => Promise<{ status(): number; text(): Promise<string> }>,
  ): Promise<void> {
    this.wrote = true;
    const response = await write(await this.version());
    expect(response.status(), await response.text()).toBe(200);
  }

  async byApplicant(
    write: (
      key: string,
    ) => Promise<{ status(): number; text(): Promise<string> }>,
  ): Promise<void> {
    this.wrote = true;
    const response = await write(hubIdempotencyKey());
    expect(response.status(), await response.text()).toBe(200);
  }
}

/** Moves one recorded instant of the application `days` into the past. */
function age(
  org: HiringOrg,
  column: "offer_extended_at" | "joined_recorded_at" | "separated_recorded_at",
  days: number,
  openingNumber: number,
  applicationNumber: number,
): void {
  sqlScalarForTenant(
    org.tenant,
    `UPDATE vetchium.org_applications AS a
     SET ${column} = now() - make_interval(days => ${Math.trunc(days)})
     FROM vetchium.org_openings AS o
     WHERE o.org_opening_id = a.org_opening_id
       AND o.org_did = ${sqlLiteral(org.did)}::uuid
       AND o.opening_number = ${Math.trunc(openingNumber)}
       AND a.application_number = ${Math.trunc(applicationNumber)}`,
  );
}
