import type { Page } from "@playwright/test";
import type {
  HubChatRequest,
  HubConversationDetail,
} from "typespec/hub/messages/messages";
import type {
  ChatRequest,
  ConversationDetail,
  ListChatRequestsResponse,
  OpeningSuggestion,
} from "typespec/orgs/marketplace/contacts/contacts";
import { sqlLiteral, sqlScalarForTenant, type TestTenant } from "./admin-db.ts";
import { expect } from "./admin-fixtures.ts";
import {
  type Applicant,
  cleanupApplicantsOf,
  seedApplicant,
} from "./hub-applicant.ts";
import { orgDID } from "./orgs-api.ts";
import { publishedOpening } from "./orgs-applications.ts";
import {
  activate,
  asProvider,
  awaitHubRequest,
  listing,
  type Pair,
  type Provider,
  published,
  setDisplayName,
  setOrgHome,
  withPair,
  withProvider,
} from "./orgs-marketplace.ts";

export interface Agency {
  pair: Pair;
  /** Two published Openings of the consumer, both assigned to the agency. */
  openings: [OpeningSuggestion, OpeningSuggestion];
  /** The agency's active `sourcing` engagement with the consumer. */
  engagementID: string;
  /** The agency's Org DID in its tenant. */
  did: string;
  /** The Orgs whose records of the seeded people are removed afterwards. */
  orgs: Array<{ tenant: TestTenant; did: string }>;
  person: (tenant?: "sgp" | "deu", displayName?: string) => Applicant;
  send: (
    to: { address: string } | { contact_id: string },
    opening: OpeningSuggestion,
    note?: string,
    key?: string,
  ) => ReturnType<Pair["provider"]["api"]["sendChatRequest"]>;
}

/**
 * An agency (in deu) with an active sourcing engagement assigned to two
 * published Openings of a consumer (in sgp), and the Hub people the test
 * seeds through `person`, all removed afterwards.
 */
export async function withAgency(
  request: Parameters<typeof withPair>[0],
  body: (agency: Agency) => Promise<void>,
  agencyName?: string,
): Promise<void> {
  await withPair(request, {}, async (pair) => {
    const { consumer, provider } = pair;
    // The engagement keeps the provider's name from when it starts.
    if (agencyName !== undefined) await setDisplayName(provider, agencyName);
    const sourcing = await activate(pair, "sourcing");
    await asProvider(pair, sourcing.id, sourcing.version);
    const openings: OpeningSuggestion[] = [];
    for (const title of ["Engineer", "Designer"]) {
      const { opening } = await publishedOpening(
        consumer.api,
        consumer.owner,
        consumer.org,
        { title },
      );
      const assigned = await consumer.api.assignOpeningProvider(
        consumer.owner,
        {
          opening_number: opening.opening_number,
          engagement_id: sourcing.id,
        },
      );
      expect(assigned.status(), await assigned.text()).toBe(200);
      openings.push({
        consumer_domain: consumer.org.domain,
        opening_number: opening.opening_number,
      });
    }
    const did = orgDID(provider.org.domain, provider.tenant);
    const orgs = [
      { tenant: provider.tenant, did },
      {
        tenant: consumer.tenant,
        did: orgDID(consumer.org.domain, consumer.tenant),
      },
    ];
    const people: Applicant[] = [];
    try {
      await body({
        pair,
        openings: openings as [OpeningSuggestion, OpeningSuggestion],
        engagementID: sourcing.id,
        did,
        orgs,
        person: (tenant = "sgp", displayName?: string) => {
          const applicant = seedApplicant(request, tenant, displayName);
          people.push(applicant);
          return applicant;
        },
        send: (to, suggestion, note, key) =>
          provider.api.sendChatRequest(
            provider.owner,
            { ...to, suggestion, ...(note === undefined ? {} : { note }) },
            key,
          ),
      });
    } finally {
      setOrgHome(did, provider.tenant);
      cleanupApplicantsOf(people, orgs);
    }
  });
}

/**
 * A second agency, in `tenant`, with an active sourcing engagement with the
 * same consumer, assigned to each of `openings`.
 */
export async function withRival(
  request: Parameters<typeof withPair>[0],
  agency: Agency,
  tenant: TestTenant,
  openings: OpeningSuggestion[],
  body: (rival: Provider) => Promise<void>,
  rivalName?: string,
): Promise<void> {
  const { consumer } = agency.pair;
  await withProvider(
    request,
    async (rival) => {
      const pair = { consumer, provider: rival };
      if (rivalName !== undefined) await setDisplayName(rival, rivalName);
      await published(rival.api, rival.owner, listing("sourcing", "Sourcing"));
      const sourcing = await activate(pair, "sourcing");
      await asProvider(pair, sourcing.id, sourcing.version);
      for (const opening of openings) {
        const assigned = await consumer.api.assignOpeningProvider(
          consumer.owner,
          {
            opening_number: opening.opening_number,
            engagement_id: sourcing.id,
          },
        );
        expect(assigned.status(), await assigned.text()).toBe(200);
      }
      agency.orgs.push({
        tenant: rival.tenant,
        did: orgDID(rival.org.domain, rival.tenant),
      });
      await body(rival);
    },
    { tenant },
  );
}

export async function sent(
  response: Awaited<ReturnType<Agency["send"]>>,
): Promise<ChatRequest> {
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as ChatRequest;
}

/** The agency's request as the Hub user's tenant lists it. */
export function pendingAt(
  applicant: Applicant,
  request: ChatRequest,
): Promise<HubChatRequest> {
  return awaitHubRequest(
    applicant,
    "to_hub_user",
    (item) =>
      item.request_id === request.request_id && item.state === "pending",
  );
}

export async function accepted(
  applicant: Applicant,
  request: ChatRequest,
  key?: string,
): Promise<HubConversationDetail> {
  await pendingAt(applicant, request);
  const response = await applicant.hub.acceptChatRequest(
    applicant.token,
    { request_id: request.request_id },
    key,
  );
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as HubConversationDetail;
}

/** Moves a side's latest activity back so the other side's window lapses. */
export function backdate(
  agency: Agency,
  contactID: string,
  side: "hub_activity_at" | "agency_activity_at",
): void {
  sqlScalarForTenant(
    agency.pair.provider.tenant,
    `UPDATE vetchium.org_conversations
     SET ${side} = now() - interval '91 days'
     WHERE contact_id = ${sqlLiteral(contactID)}::uuid`,
  );
}

export async function orgConversation(
  agency: Agency,
  contactID: string,
): Promise<ConversationDetail> {
  const { provider } = agency.pair;
  const response = await provider.api.getConversation(provider.owner, {
    contact_id: contactID,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as ConversationDetail;
}

export async function orgRequests(
  agency: Agency,
  direction: ChatRequest["direction"],
): Promise<ChatRequest[]> {
  const { provider } = agency.pair;
  const response = await provider.api.listChatRequests(provider.owner, {
    direction,
  });
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return ((await response.json()) as ListChatRequestsResponse).items;
}

/** The person's request to the agency about `opening`, once the agency
 * lists it. */
export async function personAsks(
  agency: Agency,
  person: Applicant,
  opening: OpeningSuggestion,
  agencyDomain = agency.pair.provider.org.domain,
): Promise<HubChatRequest> {
  const response = await person.hub.sendChatRequest(person.token, {
    domain: opening.consumer_domain,
    opening_number: opening.opening_number,
    agency_domain: agencyDomain,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as HubChatRequest;
}

/** Waits until the agency lists the request in `state`. */
export async function agencyRequestState(
  agency: Agency,
  direction: ChatRequest["direction"],
  requestID: string,
  state: ChatRequest["state"],
): Promise<ChatRequest> {
  let found: ChatRequest | undefined;
  await expect
    .poll(
      async () => {
        found = (await orgRequests(agency, direction)).find(
          (item) => item.request_id === requestID,
        );
        return found?.state;
      },
      { timeout: 30_000, intervals: [250, 500, 1000] },
    )
    .toBe(state);
  return found as ChatRequest;
}

/** Moves a request's sending back past the 14-day expiry in the agency's
 * tenant, for the expiry worker to find. */
export function backdateRequest(tenant: TestTenant, requestID: string): void {
  sqlScalarForTenant(
    tenant,
    `UPDATE vetchium.org_chat_requests
     SET sent_at = now() - interval '15 days'
     WHERE request_id = ${sqlLiteral(requestID)}::uuid`,
  );
}

/** Signs the browser in to the Hub portal with the seeded person's session,
 * from the next navigation on. */
export async function openHubAs(page: Page, person: Applicant): Promise<void> {
  await page.addInitScript(
    (stored) => {
      sessionStorage.setItem("vetchium.hub.session", JSON.stringify(stored));
    },
    {
      tenantId: person.tenant,
      session: {
        session_token: person.token,
        session_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        preferred_language: "en-US",
        resident_country: "US",
        handle: person.handle,
        remembered: false,
      },
    },
  );
}
