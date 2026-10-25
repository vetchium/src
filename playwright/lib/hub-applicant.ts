import { randomBytes, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import type {
  ApplicationReference,
  MyApplicationDetail,
} from "typespec/hub/applications/applications";
import type {
  ProfessionalEmail,
  ProfessionalEmailChallenge,
} from "typespec/hub/profile/professional_email";
import {
  cleanupGlobalHubPrincipals,
  cleanupHubUsers,
  seedActiveHubUser,
  seedGlobalHubPrincipal,
  sqlLiteral,
  sqlScalarForTenant,
  type TestTenant,
} from "./admin-db.ts";
import { HubAPI, hubIdempotencyKey, MAILPIT_ORIGIN } from "./hub-api.ts";

// A real Hub applicant, so applications, commands, and projection events
// travel between the applicant's tenant and the Org's.

const ALIAS_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function randomAlias(): string {
  let out = "e2e-";
  for (const byte of randomBytes(20)) {
    out += ALIAS_ALPHABET[byte % ALIAS_ALPHABET.length];
  }
  return out;
}

export interface Applicant {
  tenant: TestTenant;
  email: string;
  did: string;
  token: string;
  alias: string;
  handle: string;
  hub: HubAPI;
}

export function seedApplicant(
  request: APIRequestContext,
  tenant: TestTenant,
  displayName = "Ada Applicant",
): Applicant {
  const email = `e2e+${randomUUID()}@e2e-provider-work.example.test`;
  const alias = randomAlias();
  const seeded = seedActiveHubUser(tenant, email, displayName, alias);
  seedGlobalHubPrincipal(seeded.hubUserDID, tenant, alias, seeded.handle);
  return {
    tenant,
    email,
    did: seeded.hubUserDID,
    token: seeded.sessionToken,
    alias,
    handle: seeded.handle,
    hub: new HubAPI(request, tenant),
  };
}

/** Removes the applicant and what their applications to `orgs` left in the
 * tenants of the applicant and of each Org. */
export function cleanupApplicant(
  applicant: Applicant,
  orgs: Array<{ tenant: TestTenant; did: string }>,
): void {
  cleanupApplicantsOf([applicant], orgs);
}

/** cleanupApplicant for several applicants at once, with a few psql calls
 * per tenant however many there are. */
export function cleanupApplicantsOf(
  applicants: Applicant[],
  orgs: Array<{ tenant: TestTenant; did: string }>,
): void {
  const tenants = [...new Set(applicants.map((a) => a.tenant))];
  for (const tenant of tenants) {
    const own = applicants.filter((a) => a.tenant === tenant);
    const dids = own.map((a) => `${sqlLiteral(a.did)}::uuid`).join(", ");
    const owners = own.map((a) => sqlLiteral(a.did)).join(", ");
    const commandIDs = sqlScalarForTenant(
      tenant,
      `SELECT coalesce(string_agg(quote_literal(command_id::text), ','), '')
       FROM vetchium.federation_operations
       WHERE owner_principal_type = 'hub_user'
         AND owner_principal_id IN (${owners})`,
    );
    for (const org of orgs) {
      sqlScalarForTenant(
        org.tenant,
        `${
          commandIDs === ""
            ? ""
            : `DELETE FROM vetchium.federation_command_ledger
               WHERE command_id::text IN (${commandIDs});`
        }
         DELETE FROM vetchium.federation_outbox
         WHERE destination_principal_did IN (${dids});`,
      );
    }
    const aggregates = orgs
      .map((org) => `aggregate_id LIKE ${sqlLiteral(`${org.did}:%`)}`)
      .join(" OR ");
    sqlScalarForTenant(
      tenant,
      `${
        orgs.length === 0
          ? ""
          : `DELETE FROM vetchium.audit_events
             WHERE entity_type = 'federation_event' AND entity_id IN (
               SELECT event_id::text FROM vetchium.federation_inbox
               WHERE aggregate_type = 'org_application'
                 AND (${aggregates}));
             DELETE FROM vetchium.federation_inbox
             WHERE aggregate_type = 'org_application' AND (${aggregates});`
      }
       DELETE FROM vetchium.federation_event_watermarks
       WHERE destination_principal_did IN (${dids});`,
    );
    cleanupHubUsers(
      own.map((a) => a.email),
      tenant,
    );
  }
  cleanupGlobalHubPrincipals(
    applicants.map((a) => ({
      hubUserDID: a.did,
      alias: a.alias,
      handle: a.handle,
    })),
  );
}

/** Applies to the Opening through the Hub. */
export async function apply(
  applicant: Applicant,
  domain: string,
  openingNumber: number,
  referralAgencyDomain?: string,
  coverNote?: string,
): Promise<ApplicationReference> {
  const applied = await applicant.hub.applyToOpening(
    {
      domain,
      opening_number: openingNumber,
      ...(referralAgencyDomain
        ? { referral_agency_domain: referralAgencyDomain }
        : {}),
      ...(coverNote ? { cover_note: coverNote } : {}),
    },
    { token: applicant.token, idempotencyKey: hubIdempotencyKey() },
  );
  expect(applied.status(), await applied.text()).toBe(201);
  return (await applied.json()) as ApplicationReference;
}

export async function myApplication(
  applicant: Applicant,
  reference: ApplicationReference,
): Promise<MyApplicationDetail> {
  const response = await applicant.hub.getMyApplication(
    reference,
    applicant.token,
  );
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as MyApplicationDetail;
}

/** Adds and verifies a professional email through the Hub API, reading the
 * code from Mailpit, then moves the verification instants to the ones given
 * (ISO timestamps), so profile months are deterministic. */
export async function verifyProfessionalEmail(
  applicant: Applicant,
  emailAddress: string,
  firstVerifiedAt: string,
  lastVerifiedAt: string,
): Promise<void> {
  const options = () => ({
    token: applicant.token,
    idempotencyKey: hubIdempotencyKey(),
  });
  const added = await applicant.hub.addProfessionalEmail(
    { email_address: emailAddress },
    options(),
  );
  expect(added.status(), await added.text()).toBe(201);
  const { id } = (await added.json()) as ProfessionalEmail;
  const requested = await applicant.hub.requestProfessionalEmailCode(
    { id },
    options(),
  );
  expect(requested.status(), await requested.text()).toBe(202);
  const { challenge_id } =
    (await requested.json()) as ProfessionalEmailChallenge;
  const mailbox = `${MAILPIT_ORIGIN}/view/latest.txt?query=${encodeURIComponent(
    `to:${emailAddress}`,
  )}`;
  let text = "";
  await expect
    .poll(
      async () => {
        const mail = await fetch(mailbox);
        text = mail.ok ? await mail.text() : "";
        return text;
      },
      { timeout: 15_000 },
    )
    .toContain("Your code is");
  const code = text.match(/Your code is (\d{6})/)?.[1] ?? "";
  const verified = await applicant.hub.verifyProfessionalEmailCode(
    { id, challenge_id, code },
    options(),
  );
  expect(verified.status(), await verified.text()).toBe(204);
  sqlScalarForTenant(
    applicant.tenant,
    `UPDATE vetchium.hub_professional_emails
     SET first_verified_at = ${sqlLiteral(firstVerifiedAt)}::timestamptz,
       last_verified_at = ${sqlLiteral(lastVerifiedAt)}::timestamptz
     WHERE professional_email_id = ${sqlLiteral(id)}::uuid`,
  );
}
