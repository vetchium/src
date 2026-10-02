import {
  randomBytes,
  randomBytes as randomSuffix,
  randomUUID,
} from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { expect } from "@playwright/test";
import type { MyInfoResponse } from "typespec/orgs/account/account";
import type { LoginResponse } from "typespec/orgs/auth/login";
import type { CompleteSignupResponse } from "typespec/orgs/auth/signup";
import type { OrgDomain } from "typespec/orgs/types";
import {
  AUDIT_FAULT_LOCK,
  type AuditEvent,
  auditEventJSONForTenant,
  globalSQLScalar,
  sqlLiteral,
  sqlScalarForTenant,
  type TestTenant,
} from "./admin-db.ts";
import { setOrgVerificationRecord, uniqueOrgDomain } from "./dev-dns.ts";
import { MAILPIT_ORIGIN } from "./hub-api.ts";
import { apiOrigin, emailedLinkToken } from "./portals.ts";

export function orgsIdempotencyKey(): string {
  return `e2e-${randomBytes(30).toString("base64url")}`;
}

export function orgPassword(): string {
  return `Org-password-${randomUUID()}`;
}

export class OrgsAPI {
  readonly origin: string;

  constructor(
    readonly request: APIRequestContext,
    readonly tenant: TestTenant = "sgp",
  ) {
    this.origin = apiOrigin(tenant);
  }

  post(
    path: string,
    data?: unknown,
    options: { token?: string; idempotencyKey?: string } = {},
  ): Promise<APIResponse> {
    const headers: Record<string, string> = {};
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }
    return this.request.post(`${this.origin}/api/orgs${path}`, {
      data,
      headers,
    });
  }

  postRaw(
    path: string,
    body: string,
    options: { idempotencyKey?: string } = {},
  ): Promise<APIResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }
    return this.request.post(`${this.origin}/api/orgs${path}`, {
      data: body,
      headers,
    });
  }

  myInfo(token?: string): Promise<APIResponse> {
    return this.request.get(`${this.origin}/api/orgs/my-info`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }
}

/** Waits for the newest message to `emailAddress` whose subject contains
 * `subject`, and returns its plain text. */
export async function orgEmailText(
  request: APIRequestContext,
  emailAddress: string,
  subject: string,
): Promise<string> {
  const url = `${MAILPIT_ORIGIN}/view/latest.txt?query=${encodeURIComponent(
    `to:${emailAddress} subject:"${subject}"`,
  )}`;
  let text = "";
  await expect
    .poll(
      async () => {
        const response = await request.get(url);
        text = response.ok() ? await response.text() : "";
        return text.length > 0;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return text;
}

/** Counts messages to `emailAddress`. Mailpit's JSON API is called with plain
 * fetch so API-coverage tracking does not report it as Vetchium behavior. */
export async function orgEmailCount(emailAddress: string): Promise<number> {
  const response = await fetch(
    `${MAILPIT_ORIGIN}/api/v1/search?query=${encodeURIComponent(
      `to:${emailAddress}`,
    )}`,
  );
  const body = (await response.json()) as { messages_count: number };
  return body.messages_count;
}

export function recordValue(dnsEmail: string): string {
  const value = dnsEmail.match(/vetchium-verify=[a-z2-7]{26}/)?.[0];
  if (!value) throw new Error("DNS instructions carried no record value");
  return value;
}

export function signupToken(linkEmail: string, tenant: TestTenant): string {
  const token = emailedLinkToken(linkEmail, "/complete-signup", tenant);
  if (!token) throw new Error(`signup link email carried no ${tenant} token`);
  return token;
}

export interface PendingOrgSignup {
  domain: OrgDomain;
  emailAddress: string;
  token: string;
  value: string;
}

/** Requests an Org signup and reads both emails, without publishing DNS. */
export async function requestOrgSignup(
  api: OrgsAPI,
  domain: OrgDomain = uniqueOrgDomain(),
  local = "it",
): Promise<PendingOrgSignup> {
  const emailAddress = `${local}@${domain}`;
  const response = await api.post(
    "/request-signup",
    { email_address: emailAddress, preferred_language: "en-US" },
    { idempotencyKey: orgsIdempotencyKey() },
  );
  expect(response.status(), await response.text()).toBe(202);
  const dns = await orgEmailText(api.request, emailAddress, "DNS record");
  const link = await orgEmailText(api.request, emailAddress, "Complete");
  return {
    domain,
    emailAddress,
    token: signupToken(link, api.tenant),
    value: recordValue(dns),
  };
}

export interface SignedUpOrg {
  domain: OrgDomain;
  emailAddress: string;
  password: string;
  value: string;
}

/** Signs an Org up end to end: request, publish the record, complete. */
export async function signupOrg(
  api: OrgsAPI,
  domain: OrgDomain = uniqueOrgDomain(),
): Promise<SignedUpOrg> {
  const pending = await requestOrgSignup(api, domain);
  await setOrgVerificationRecord(domain, [pending.value]);
  const password = orgPassword();
  const response = await api.post(
    "/complete-signup",
    {
      signup_token: pending.token,
      org_display_name: "Playwright Org",
      password,
    },
    { idempotencyKey: orgsIdempotencyKey() },
  );
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as CompleteSignupResponse;
  expect(body.domain).toBe(domain);
  return {
    domain,
    emailAddress: pending.emailAddress,
    password,
    value: pending.value,
  };
}

export async function loginOrg(
  api: OrgsAPI,
  org: Pick<SignedUpOrg, "domain" | "emailAddress" | "password">,
): Promise<string> {
  const response = await api.post("/login", {
    domain: org.domain,
    email_address: org.emailAddress,
    password: org.password,
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as LoginResponse;
  if (body.authentication_state !== "authenticated") {
    throw new Error("Org login unexpectedly required a second factor");
  }
  return body.session_token;
}

export async function orgInfo(
  api: OrgsAPI,
  token: string,
): Promise<MyInfoResponse> {
  const response = await api.myInfo(token);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as MyInfoResponse;
}

function assertOwnedOrgDomain(domain: string): void {
  if (!/^org-[0-9a-f-]+\.example$/.test(domain)) {
    throw new Error(`refusing Org cleanup for non-test domain: ${domain}`);
  }
}

/** Removes every tenant and global row a test created for `domain`. */
export function cleanupOrg(domain: string, tenant: TestTenant = "sgp"): void {
  assertOwnedOrgDomain(domain);
  const value = sqlLiteral(domain);
  const pattern = sqlLiteral(`%@${domain}`);
  const dids = globalSQLScalar(
    `SELECT string_agg(quote_literal(org_did::text), ',')
     FROM vetchium.org_principals
     WHERE org_did IN (
       SELECT org_did FROM vetchium.org_domains WHERE domain = ${value}
     ) OR org_did::text IN (
       SELECT aggregate_id FROM vetchium.global_outbox_events
       WHERE aggregate_type = 'org_principal'
         AND payload -> 'principal' ->> 'domain' = ${value}
     )`,
  );
  const localDIDs = sqlScalarForTenant(
    tenant,
    `SELECT string_agg(quote_literal(org_did::text), ',') FROM (
       SELECT org_did FROM vetchium.org_domains WHERE domain = ${value}
       UNION SELECT org_did FROM vetchium.org_signup_completions
       WHERE domain = ${value}
     ) AS owned`,
  );
  const didList = [dids, localDIDs].filter((list) => list !== "").join(",");
  const hasDID = (column: string) =>
    didList === "" ? "false" : `${column} IN (${didList})`;
  sqlScalarForTenant(
    tenant,
    `
    DELETE FROM vetchium.audit_events
    WHERE ${hasDID("entity_id")}
       OR entity_id IN (
         SELECT org_user_id::text FROM vetchium.org_users
         WHERE email_address LIKE ${pattern}
       )
       OR actor_id IN (
         SELECT org_user_id::text FROM vetchium.org_users
         WHERE email_address LIKE ${pattern}
       )
       OR idempotency_key IN (
         SELECT idempotency_key FROM vetchium.org_signup_completions
         WHERE domain = ${value}
       )
       OR entity_id IN (
         SELECT org_signup_request_id::text FROM vetchium.org_signup_requests
         WHERE domain = ${value}
         UNION SELECT operation_id::text FROM vetchium.org_signup_completions
         WHERE domain = ${value}
         UNION SELECT org_email_outbox_id::text FROM vetchium.org_email_outbox
         WHERE recipient_email_address LIKE ${pattern}
         UNION SELECT t.org_password_reset_token_id::text
         FROM vetchium.org_password_reset_tokens AS t
         JOIN vetchium.org_users AS u USING (org_user_id)
         WHERE u.email_address LIKE ${pattern}
       )
       OR payload ->> 'domain' = ${value};
    DELETE FROM vetchium.org_signup_completions WHERE domain = ${value};
    DELETE FROM vetchium.org_signup_requests WHERE domain = ${value};
    DELETE FROM vetchium.org_email_outbox
    WHERE recipient_email_address LIKE ${pattern};
    DELETE FROM vetchium.idempotency_ledger
    WHERE binding_id LIKE ${pattern} OR binding_id LIKE ${sqlLiteral(`${domain}/%`)};
    DELETE FROM vetchium.orgs WHERE ${hasDID("org_did::text")};
    `,
  );
  if (didList !== "") {
    globalSQLScalar(
      `
      DELETE FROM vetchium.org_domains WHERE org_did::text IN (${didList});
      DELETE FROM vetchium.global_audit_events
      WHERE entity_type = 'org_principal' AND entity_id IN (${didList});
      DELETE FROM vetchium.global_outbox_events
      WHERE aggregate_type = 'org_principal' AND aggregate_id IN (${didList});
      DELETE FROM vetchium.org_principals WHERE org_did::text IN (${didList});
      `,
    );
  }
}

/** Runs one SQL statement in a tenant database, for test setup only. */
export function orgSQL(sql: string, tenant: TestTenant = "sgp"): string {
  return sqlScalarForTenant(tenant, sql);
}

function assertOrgAuditAction(action: string): void {
  if (!/^org(_user)?\.[a-z0-9._-]+$/.test(action)) {
    throw new Error(`refusing malformed Org audit action: ${action}`);
  }
}

/** Audit events whose entity or actor is one of `ids`, oldest first. */
export function orgAuditEvents(
  ids: string[],
  tenant: TestTenant = "sgp",
): AuditEvent[] {
  if (ids.length === 0) return [];
  const list = ids.map(sqlLiteral).join(", ");
  return auditEventJSONForTenant(
    tenant,
    `entity_id IN (${list}) OR actor_id IN (${list})`,
  );
}

export function orgAuditEventsByKey(
  key: string,
  tenant: TestTenant = "sgp",
): AuditEvent[] {
  return auditEventJSONForTenant(
    tenant,
    `idempotency_key = ${sqlLiteral(key)}`,
  );
}

export function orgUserID(emailAddress: string, tenant: TestTenant = "sgp") {
  return sqlScalarForTenant(
    tenant,
    `SELECT org_user_id FROM vetchium.org_users
     WHERE email_address = ${sqlLiteral(emailAddress)}`,
  );
}

export function orgDID(domain: string, tenant: TestTenant = "sgp") {
  return sqlScalarForTenant(
    tenant,
    `SELECT org_did FROM vetchium.org_domains
     WHERE domain = ${sqlLiteral(domain)}`,
  );
}

/**
 * Makes inserting the named audit event fail for rows matching the given
 * test-owned identifiers, so a test can prove the audited write rolls back
 * with it. Returns the function that removes the fault.
 */
export function installOrgAuditInsertFailure(
  match: {
    action: string;
    entityID?: string;
    actorID?: string;
    idempotencyKey?: string;
    domain?: string;
  },
  tenant: TestTenant = "sgp",
): () => void {
  assertOrgAuditAction(match.action);
  const predicates = [`NEW.action = ${sqlLiteral(match.action)}`];
  if (match.entityID)
    predicates.push(`NEW.entity_id = ${sqlLiteral(match.entityID)}`);
  if (match.actorID)
    predicates.push(`NEW.actor_id = ${sqlLiteral(match.actorID)}`);
  if (match.idempotencyKey) {
    predicates.push(
      `NEW.idempotency_key = ${sqlLiteral(match.idempotencyKey)}`,
    );
  }
  if (match.domain) {
    assertOwnedOrgDomain(match.domain);
    predicates.push(`NEW.payload ->> 'domain' = ${sqlLiteral(match.domain)}`);
  }
  if (predicates.length === 1) {
    throw new Error("audit failure must be scoped to a test-owned identifier");
  }
  const name = `e2e_fail_org_audit_${randomSuffix(8).toString("hex")}`;
  sqlScalarForTenant(
    tenant,
    `
    ${AUDIT_FAULT_LOCK}
    CREATE FUNCTION vetchium.${name}() RETURNS trigger LANGUAGE plpgsql
    AS $function$ BEGIN RAISE EXCEPTION 'injected Org audit failure'; END
    $function$;
    CREATE TRIGGER ${name} BEFORE INSERT ON vetchium.audit_events
    FOR EACH ROW WHEN (${predicates.join(" AND ")})
    EXECUTE FUNCTION vetchium.${name}();
    `,
  );
  let installed = true;
  return () => {
    if (!installed) return;
    sqlScalarForTenant(
      tenant,
      `${AUDIT_FAULT_LOCK}
       DROP TRIGGER ${name} ON vetchium.audit_events;
       DROP FUNCTION vetchium.${name}();`,
    );
    installed = false;
  };
}
