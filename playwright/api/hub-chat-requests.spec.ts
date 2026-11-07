import { randomUUID } from "node:crypto";
import type { DeliverEventRequest } from "typespec/federation/events";
import {
  HubAccountAggregate,
  HubAccountDeletedKind,
} from "typespec/federation/marketplace";
import type {
  HubChatRequest,
  HubConversationDetail,
  ListConversationsResponse,
  ListOpeningAgenciesResponse,
  OpeningAgency,
  OpeningAgencyChatState,
} from "typespec/hub/messages/messages";
import type {
  ChatRequest,
  ConversationDetail,
  OpeningSuggestion,
  PendingChatRequestCount,
} from "typespec/orgs/marketplace/contacts/contacts";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { expectProblem } from "../lib/admin-api.ts";
import { sqlLiteral, sqlScalarForTenant } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { hubIdempotencyKey } from "../lib/hub-api.ts";
import type { Applicant } from "../lib/hub-applicant.ts";
import { meshPeerRequest } from "../lib/mesh.ts";
import {
  addOrgMember,
  inviteeAddress,
  orgDID,
  orgEmailText,
  orgsIdempotencyKey,
} from "../lib/orgs-api.ts";
import { publishedOpening, reread } from "../lib/orgs-applications.ts";
import {
  type Agency,
  accepted,
  backdate,
  orgRequests,
  pendingAt,
  sent,
  withAgency,
  withRival,
} from "../lib/orgs-chat-requests.ts";
import { awaitHubRequest, setOrgHome } from "../lib/orgs-marketplace.ts";

const BASE = "vetchium-problem-details/";
const PROBLEMS = {
  orgNotFound: `${BASE}hub-org-not-found`,
  openingNotFound: `${BASE}hub-opening-not-found`,
  orgUnavailable: `${BASE}hub-org-unavailable`,
  notAssigned: `${BASE}hub-agency-not-assigned`,
  limit: `${BASE}hub-chat-request-limit-reached`,
  exists: `${BASE}hub-chat-request-exists`,
  open: `${BASE}hub-conversation-open`,
  blocked: `${BASE}hub-chat-request-blocked`,
  partyDeleted: `${BASE}hub-conversation-party-deleted`,
  hubAuth: `${BASE}hub-authentication-required`,
  validation: `${BASE}validation-failed`,
  invalidJSON: `${BASE}invalid-json`,
  keyConflict: `${BASE}idempotency-key-conflict`,
  orgRequestNotFound: `${BASE}org-chat-request-not-found`,
  orgPartyDeleted: `${BASE}org-conversation-party-deleted`,
  orgRequestsOff: `${BASE}org-agency-requests-off`,
  orgContactLimit: `${BASE}org-contact-limit-reached`,
};

const DAY = 24 * 60 * 60 * 1000;

function openingOf(opening: OpeningSuggestion) {
  return {
    domain: opening.consumer_domain,
    opening_number: opening.opening_number,
  };
}

async function openingAgencies(
  person: Applicant,
  opening: OpeningSuggestion,
): Promise<OpeningAgency[]> {
  const response = await person.hub.listOpeningAgencies(
    person.token,
    openingOf(opening),
  );
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return ((await response.json()) as ListOpeningAgenciesResponse).items;
}

/** Waits until the Opening page shows `state` with the agency. */
async function awaitChatState(
  person: Applicant,
  opening: OpeningSuggestion,
  agencyDomain: string,
  state: OpeningAgencyChatState,
): Promise<OpeningAgency> {
  let found: OpeningAgency | undefined;
  await expect
    .poll(
      async () => {
        found = (await openingAgencies(person, opening)).find(
          (item) => item.agency_domain === agencyDomain,
        );
        return found?.chat_state;
      },
      { timeout: 30_000, intervals: [250, 500, 1000] },
    )
    .toBe(state);
  return found as OpeningAgency;
}

function hubSend(
  person: Applicant,
  opening: OpeningSuggestion,
  agencyDomain: string,
  note?: string,
  key?: string,
) {
  return person.hub.sendChatRequest(
    person.token,
    {
      ...openingOf(opening),
      agency_domain: agencyDomain,
      ...(note === undefined ? {} : { note }),
    },
    key,
  );
}

async function hubSent(
  response: Awaited<ReturnType<typeof hubSend>>,
): Promise<HubChatRequest> {
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as HubChatRequest;
}

/** The Hub user's request as the agency lists it. */
async function atAgency(
  agency: Agency,
  requestID: string,
): Promise<ChatRequest | undefined> {
  return (await orgRequests(agency, "to_agency")).find(
    (item) => item.request_id === requestID,
  );
}

async function agencyAccepts(
  agency: Agency,
  requestID: string,
  token = agency.pair.provider.owner,
): Promise<ConversationDetail> {
  const response = await agency.pair.provider.api.acceptChatRequest(token, {
    request_id: requestID,
  });
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as ConversationDetail;
}

async function agencyDeclines(
  agency: Agency,
  requestID: string,
  scope: ChatRequest["decline_scope"] & string,
): Promise<ChatRequest> {
  const response = await agency.pair.provider.api.declineChatRequest(
    agency.pair.provider.owner,
    { request_id: requestID, scope },
  );
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as ChatRequest;
}

/** The Hub user's tenant shows the agency's answer to the user's request. */
function answeredAt(
  person: Applicant,
  request: HubChatRequest,
  state: HubChatRequest["state"],
): Promise<HubChatRequest> {
  return awaitHubRequest(
    person,
    "to_agency",
    (item) => item.request_id === request.request_id && item.state === state,
  );
}

/**
 * Waits until the agency's pointer event carried the conversation window to
 * the Hub user's tenant, so a later backdate is not overwritten by it.
 */
async function awaitWindow(
  person: Applicant,
  contactID: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await person.hub.listConversations(person.token);
        if (response.status() !== 200) return undefined;
        return (
          (await response.json()) as ListConversationsResponse
        ).items.find((item) => item.contact_id === contactID)
          ?.hub_may_write_until;
      },
      { timeout: 30_000, intervals: [250, 500, 1000] },
    )
    .toBeDefined();
}

/** Lapses the Hub user's window at the Hub user's tenant only. */
async function lapseHubPointer(
  person: Applicant,
  contactID: string,
): Promise<void> {
  await awaitWindow(person, contactID);
  sqlScalarForTenant(
    person.tenant,
    `UPDATE vetchium.hub_agency_pointers
     SET hub_may_write_until = now() - interval '1 minute'
     WHERE contact_id = ${sqlLiteral(contactID)}::uuid`,
  );
}

/**
 * Lapses the Hub user's side of an open conversation in both tenants, so the
 * Hub user may only ask again while the agency may still write.
 */
async function closeForHub(
  agency: Agency,
  person: Applicant,
  contactID: string,
): Promise<void> {
  backdate(agency, contactID, "agency_activity_at");
  await lapseHubPointer(person, contactID);
}

/** Account deletion is not built, so its notice is delivered directly. */
function deliverAccountDeleted(
  agency: Agency,
  person: Applicant,
  apiCoverage: Parameters<typeof meshPeerRequest>[3],
): void {
  const delivered = meshPeerRequest(
    person.tenant,
    agency.pair.provider.tenant,
    {
      event_id: randomUUID(),
      kind: HubAccountDeletedKind,
      destination_principal_type: "org",
      destination_principal_did: agency.did,
      aggregate_type: HubAccountAggregate,
      aggregate_id: person.did,
      aggregate_version: 1,
      payload: { hub_user_did: person.did },
    } satisfies DeliverEventRequest,
    apiCoverage,
    { path: "/api/mesh/events/deliver" },
  );
  expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
}

function presetHubCount(person: Applicant, created: number): void {
  const today = new Date().toISOString().slice(0, 10);
  sqlScalarForTenant(
    person.tenant,
    `INSERT INTO vetchium.hub_chat_request_creations
       (hub_user_did, created_on, created)
     VALUES (${sqlLiteral(person.did)}::uuid, '${today}'::date, ${created})
     ON CONFLICT (hub_user_did, created_on) DO UPDATE SET created = ${created}`,
  );
}

test("MKT-HUB-005: an Opening lists every assigned agency, read locally or relayed, without a DID, and none when unassigned", async ({
  request,
}) => {
  test.setTimeout(180_000);
  await withAgency(request, async (agency) => {
    const { consumer, provider } = agency.pair;
    const [opening] = agency.openings;
    const local = agency.person("sgp");
    const relayed = agency.person("deu");
    const consumerDID = orgDID(consumer.org.domain, consumer.tenant);

    await withRival(request, agency, "sgp", [opening], async (rival) => {
      const rivalDID = orgDID(rival.org.domain, rival.tenant);
      for (const person of [local, relayed]) {
        const response = await person.hub.listOpeningAgencies(
          person.token,
          openingOf(opening),
        );
        expect(response.status(), await response.text()).toBe(200);
        const text = await response.text();
        for (const did of [agency.did, rivalDID, consumerDID]) {
          expect(text).not.toContain(did);
        }
        const items = (JSON.parse(text) as ListOpeningAgenciesResponse).items;
        expect(
          items
            .map((item) => [item.agency_domain, item.chat_state])
            .sort(([a], [b]) => String(a).localeCompare(String(b))),
        ).toEqual(
          [
            [provider.org.domain, "none"],
            [rival.org.domain, "none"],
          ].sort(([a], [b]) => String(a).localeCompare(String(b))),
        );
        for (const item of items) {
          expect(item.agency_display_name).toBeTruthy();
          expect(item.contact_id).toBeUndefined();
          expect(item.latest_request).toBeUndefined();
        }
      }
    });

    const { opening: unassigned } = await publishedOpening(
      consumer.api,
      consumer.owner,
      consumer.org,
      { title: "Unassigned" },
    );
    const { opening: toPause } = await publishedOpening(
      consumer.api,
      consumer.owner,
      consumer.org,
      { title: "Paused" },
    );
    const assigned = await consumer.api.assignOpeningProvider(consumer.owner, {
      opening_number: toPause.opening_number,
      engagement_id: agency.engagementID,
    });
    expect(assigned.status(), await assigned.text()).toBe(200);
    const paused = await consumer.api.requestOpeningChange(consumer.owner, {
      opening_number: toPause.opening_number,
      version: (await reread(consumer.api, consumer.owner, toPause)).version,
      kind: "pause",
    });
    expect(paused.status(), await paused.text()).toBe(200);
    expect(((await paused.json()) as OrgOpening).state).toBe("paused");
    const suggestion = (number: number): OpeningSuggestion => ({
      consumer_domain: consumer.org.domain,
      opening_number: number,
    });

    for (const person of [local, relayed]) {
      expect(
        await openingAgencies(person, suggestion(unassigned.opening_number)),
      ).toEqual([]);
      for (const missing of [toPause.opening_number, 99_999]) {
        await expectProblem(
          await person.hub.listOpeningAgencies(
            person.token,
            openingOf(suggestion(missing)),
          ),
          404,
          PROBLEMS.openingNotFound,
        );
        await expectProblem(
          await hubSend(person, suggestion(missing), provider.org.domain),
          404,
          PROBLEMS.openingNotFound,
        );
      }
      await expectProblem(
        await person.hub.listOpeningAgencies(person.token, {
          domain: `missing-${randomUUID()}.example.test`,
          opening_number: 1,
        }),
        404,
        PROBLEMS.orgNotFound,
      );
      await expectProblem(
        await person.hub.sendChatRequest(person.token, {
          domain: `missing-${randomUUID()}.example.test`,
          opening_number: 1,
          agency_domain: provider.org.domain,
        }),
        404,
        PROBLEMS.orgNotFound,
      );
      // An agency the Opening does not name is refused before any request.
      for (const [at, domain] of [
        [unassigned.opening_number, provider.org.domain],
        [opening.opening_number, `nobody-${randomUUID()}.example.test`],
      ] as const) {
        await expectProblem(
          await hubSend(person, suggestion(at), domain),
          422,
          PROBLEMS.notAssigned,
        );
      }
    }

    // The relayed read fails while the consumer's tenant does not answer.
    setOrgHome(consumerDID, "gone");
    try {
      await expectProblem(
        await relayed.hub.listOpeningAgencies(
          relayed.token,
          openingOf(opening),
        ),
        503,
        PROBLEMS.orgUnavailable,
      );
      await expectProblem(
        await hubSend(relayed, opening, provider.org.domain),
        503,
        PROBLEMS.orgUnavailable,
      );
    } finally {
      setOrgHome(consumerDID, consumer.tenant);
    }
  });
});

test("Hub list-opening-agencies and send-chat-request authenticate and validate", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const [opening] = agency.openings;
    const person = agency.person("sgp");
    const domain = agency.pair.provider.org.domain;
    const routes = [
      {
        path: "/list-opening-agencies",
        body: openingOf(opening),
        write: false,
      },
      {
        path: "/send-chat-request",
        body: { ...openingOf(opening), agency_domain: domain },
        write: true,
      },
    ];
    const keyed = (write: boolean) =>
      write ? { idempotencyKey: hubIdempotencyKey() } : {};
    for (const route of routes) {
      await expectProblem(
        await person.hub.post(route.path, route.body, keyed(route.write)),
        401,
        PROBLEMS.hubAuth,
      );
      await expectProblem(
        await person.hub.postRaw(route.path, "{", {
          token: person.token,
          ...keyed(route.write),
        }),
        400,
        PROBLEMS.invalidJSON,
      );
    }
    for (const [path, body, fields, write] of [
      [
        "/list-opening-agencies",
        { domain: "not a domain", opening_number: 0 },
        ["domain", "opening_number"],
        false,
      ],
      [
        "/send-chat-request",
        {
          domain: "not a domain",
          opening_number: 0,
          agency_domain: "nor this",
          note: "x".repeat(2_000),
        },
        ["domain", "opening_number", "agency_domain", "note"],
        true,
      ],
    ] as const) {
      await expectProblem(
        await person.hub.post(path, body, {
          token: person.token,
          ...keyed(write),
        }),
        400,
        PROBLEMS.validation,
        [...fields],
      );
    }
  });
});

test("MKT-HUB-005: the Opening shows each chat state with an agency as it changes", async ({
  request,
}) => {
  test.setTimeout(180_000);
  await withAgency(request, async (agency) => {
    const [opening, other] = agency.openings;
    const person = agency.person("sgp");
    const domain = agency.pair.provider.org.domain;
    await awaitChatState(person, opening, domain, "none");

    const theirs = await sent(
      await agency.send({ address: person.handle }, opening),
    );
    const received = await awaitChatState(
      person,
      opening,
      domain,
      "request_received",
    );
    expect(received.contact_id).toBe(theirs.contact_id);
    expect(received.latest_request).toMatchObject({
      request_id: theirs.request_id,
      direction: "to_hub_user",
      state: "pending",
    });
    await accepted(person, theirs);
    await awaitChatState(person, opening, domain, "open");

    await closeForHub(agency, person, theirs.contact_id);
    await awaitChatState(person, opening, domain, "closed");

    const mine = await hubSent(await hubSend(person, opening, domain));
    const sentState = await awaitChatState(
      person,
      opening,
      domain,
      "request_sent",
    );
    expect(sentState.latest_request?.request_id).toBe(mine.request_id);

    await agencyDeclines(agency, mine.request_id, "opening");
    await answeredAt(person, mine, "declined");
    await awaitChatState(person, opening, domain, "declined");
    await awaitChatState(person, other, domain, "closed");
  });
});

test("MKT-REQ-002, MKT-DAT-014: a Hub user's request reaches the agency across tenants with its note, a repeat replays it, and a silent agency tenant leaves it pending", async ({
  request,
}) => {
  test.setTimeout(180_000);
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening, other] = agency.openings;
    const domain = provider.org.domain;
    // In deu, the Opening's read is relayed to sgp; in sgp, the request is
    // the one that crosses to the agency in deu.
    const relayed = agency.person("deu");
    const local = agency.person("sgp");
    const marker = `note-${randomUUID()}`;

    const key = hubIdempotencyKey();
    const first = await hubSent(
      await hubSend(relayed, opening, domain, marker, key),
    );
    expect(first).toMatchObject({
      direction: "to_agency",
      state: "pending",
      opening,
      agency_domain: domain,
      window_days: 90,
    });
    expect(JSON.stringify(first)).not.toContain(marker);
    const replayed = await hubSent(
      await hubSend(relayed, opening, domain, marker, key),
    );
    expect(replayed.request_id).toBe(first.request_id);
    await expectProblem(
      await hubSend(relayed, opening, domain, "Another note", key),
      409,
      PROBLEMS.keyConflict,
    );
    const second = await hubSent(await hubSend(local, other, domain));

    const listed = await orgRequests(agency, "to_agency");
    expect(listed.map((item) => item.request_id).sort()).toEqual(
      [first.request_id, second.request_id].sort(),
    );
    expect(listed.find((item) => item.request_id === first.request_id)).toEqual(
      expect.objectContaining({
        contact_id: first.contact_id,
        state: "pending",
        opening,
        note: marker,
        hub_user_handle: relayed.handle,
      }),
    );
    const count = await provider.api.countPendingChatRequests(provider.owner);
    expect((await count.json()) as PendingChatRequestCount).toEqual({
      count: 2,
    });
    const own = await awaitHubRequest(
      relayed,
      "to_agency",
      (item) => item.request_id === first.request_id,
    );
    expect(JSON.stringify(own)).not.toContain(marker);

    // The agency's tenant does not confirm: the request waits, and its
    // repeat completes once the tenant answers.
    const later = agency.person("sgp");
    const laterKey = hubIdempotencyKey();
    setOrgHome(agency.did, "usa1");
    try {
      const pending = await hubSend(
        later,
        opening,
        domain,
        undefined,
        laterKey,
      );
      expect(pending.status(), await pending.text()).toBe(202);
      expect(pending.headers()["cache-control"]).toBe("no-store");
      expect(
        ((await pending.json()) as { operation_id: string }).operation_id,
      ).toBeTruthy();
    } finally {
      setOrgHome(agency.did, provider.tenant);
    }
    const recovered = await hubSent(
      await hubSend(later, opening, domain, undefined, laterKey),
    );
    expect(await atAgency(agency, recovered.request_id)).toMatchObject({
      state: "pending",
    });
  });
});

test("MKT-REQ-003: the Hub user's request is refused with hub-* problems, by the pointer and by the agency, and first of all for a deleted party", async ({
  request,
  apiCoverage,
}) => {
  test.setTimeout(180_000);
  await withAgency(request, async (agency) => {
    const [opening, other] = agency.openings;
    const domain = agency.pair.provider.org.domain;

    // Either direction pending.
    const asking = agency.person("sgp");
    const mine = await hubSent(await hubSend(asking, opening, domain));
    await expectProblem(
      await hubSend(asking, other, domain),
      409,
      PROBLEMS.exists,
    );
    const asked = agency.person("sgp");
    const theirs = await sent(
      await agency.send({ address: asked.handle }, opening),
    );
    await pendingAt(asked, theirs);
    await expectProblem(
      await hubSend(asked, opening, domain),
      409,
      PROBLEMS.exists,
    );

    // An open conversation.
    await accepted(asked, theirs);
    await expectProblem(
      await hubSend(asked, opening, domain),
      409,
      PROBLEMS.open,
    );

    // A decline for the Opening.
    await agencyDeclines(agency, mine.request_id, "opening");
    await answeredAt(asking, mine, "declined");
    await expectProblem(
      await hubSend(asking, opening, domain),
      403,
      PROBLEMS.blocked,
    );

    // A deleted person is refused first, even while the conversation is
    // still open at the agency; the person's pointer does not know it.
    const gone = agency.person("deu");
    const opened = await sent(
      await agency.send({ address: gone.handle }, opening),
    );
    await accepted(gone, opened);
    await lapseHubPointer(gone, opened.contact_id);
    deliverAccountDeleted(agency, gone, apiCoverage);
    await expectProblem(
      await hubSend(gone, other, domain),
      409,
      PROBLEMS.partyDeleted,
    );
  });
});

test("MKT-REQ-006: a Hub user sends at most 10 requests a UTC day; refusals by the agency count, refusals by the pointer and repeats do not", async ({
  request,
}) => {
  test.setTimeout(180_000);
  await withAgency(request, async (agency) => {
    const [opening, other] = agency.openings;
    const domain = agency.pair.provider.org.domain;
    const person = agency.person("sgp");

    // The pointer keeps only the latest request, so the agency alone knows
    // the older decline for `opening`.
    const first = await hubSent(await hubSend(person, opening, domain));
    await agencyDeclines(agency, first.request_id, "opening");
    await answeredAt(person, first, "declined");
    const second = await hubSent(await hubSend(person, other, domain));
    await agencyDeclines(agency, second.request_id, "opening");
    await answeredAt(person, second, "declined");

    await withRival(request, agency, "sgp", [opening], async (rival) => {
      presetHubCount(person, 8);
      // Refused by the pointer: not counted.
      await expectProblem(
        await hubSend(person, other, domain),
        403,
        PROBLEMS.blocked,
      );
      // Refused by the agency: the 9th.
      await expectProblem(
        await hubSend(person, opening, domain),
        403,
        PROBLEMS.blocked,
      );
      // The 10th, and its repeat.
      const key = hubIdempotencyKey();
      const tenth = await hubSent(
        await hubSend(person, opening, rival.org.domain, undefined, key),
      );
      const repeat = await hubSent(
        await hubSend(person, opening, rival.org.domain, undefined, key),
      );
      expect(repeat.request_id).toBe(tenth.request_id);
      await expectProblem(
        await hubSend(person, opening, domain),
        429,
        PROBLEMS.limit,
      );
    });
  });
});

test("MKT-REQ-005, MKT-REQ-007: the agency answers a Hub user's request, and its declines bind only the Hub user's direction", async ({
  request,
}) => {
  test.setTimeout(180_000);
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening, other] = agency.openings;
    const domain = provider.org.domain;

    // Accepting opens the conversation, and the Hub user may write.
    const welcome = agency.person("sgp");
    const asked = await hubSent(
      await hubSend(welcome, opening, domain, "Keen on this role"),
    );
    const detail = await agencyAccepts(agency, asked.request_id);
    expect(detail.conversation.contact_id).toBe(asked.contact_id);
    expect(detail.conversation.agency_may_write_until).toBeDefined();
    expect(await atAgency(agency, asked.request_id)).toMatchObject({
      state: "accepted",
    });
    expect(detail.messages).toEqual([
      expect.objectContaining({
        kind: "request",
        sender_type: "hub_user",
        suggestion: opening,
        note: "Keen on this role",
      }),
    ]);
    await answeredAt(welcome, asked, "accepted");
    await awaitChatState(welcome, opening, domain, "open");
    const reply = await welcome.hub.replyToConversation(welcome.token, {
      contact_id: asked.contact_id,
      text: "Thanks for accepting.",
    });
    expect(reply.status(), await reply.text()).toBe(200);

    // An Opening decline refuses the Hub user's request about it, never the
    // agency's request to the Hub user.
    const forOpening = agency.person("sgp");
    const one = await hubSent(await hubSend(forOpening, opening, domain));
    const declinedOne = await agencyDeclines(agency, one.request_id, "opening");
    expect(declinedOne).toMatchObject({
      state: "declined",
      decline_scope: "opening",
    });
    expect(declinedOne.blocked_until).toBeUndefined();
    await answeredAt(forOpening, one, "declined");
    await expectProblem(
      await hubSend(forOpening, opening, domain),
      403,
      PROBLEMS.blocked,
    );
    await sent(await agency.send({ address: forOpening.handle }, opening));

    // A sender decline refuses every Opening for the window, and still not
    // the agency's request.
    const forSender = agency.person("sgp");
    const two = await hubSent(await hubSend(forSender, opening, domain));
    const declinedTwo = await agencyDeclines(agency, two.request_id, "sender");
    const until = Date.parse(declinedTwo.blocked_until ?? "");
    expect(until).toBeGreaterThan(Date.now() + 89 * DAY);
    expect(until).toBeLessThan(Date.now() + 91 * DAY);
    const shown = await answeredAt(forSender, two, "declined");
    expect(shown).toMatchObject({
      decline_scope: "sender",
      blocked_until: declinedTwo.blocked_until,
    });
    await expectProblem(
      await hubSend(forSender, other, domain),
      403,
      PROBLEMS.blocked,
    );
    const theirs = await sent(
      await agency.send({ address: forSender.handle }, other),
    );
    // Once the Hub user answers the agency, the pointer no longer shows the
    // block; the agency still refuses until it lifts.
    await pendingAt(forSender, theirs);
    const answered = await forSender.hub.declineChatRequest(forSender.token, {
      request_id: theirs.request_id,
      scope: "opening",
    });
    expect(answered.status(), await answered.text()).toBe(200);
    await expectProblem(
      await hubSend(forSender, opening, domain),
      403,
      PROBLEMS.blocked,
    );
    sqlScalarForTenant(
      provider.tenant,
      `UPDATE vetchium.org_chat_request_blocks
       SET blocked_until = now() - interval '1 minute',
         created_at = now() - interval '91 days'
       WHERE contact_id = ${sqlLiteral(two.contact_id)}::uuid
         AND blocked_direction = 'to_agency' AND scope = 'sender'`,
    );
    await hubSent(await hubSend(forSender, opening, domain));
  });
});

test("Orgs answers to Hub requests: a colleague answers from the shared inbox, the email names the agency only, and only pending requests to the agency are found", async ({
  request,
  apiCoverage,
}) => {
  test.setTimeout(180_000);
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening, other] = agency.openings;
    const domain = provider.org.domain;
    const colleague = await addOrgMember(
      provider.api,
      provider.owner,
      domain,
      inviteeAddress(domain, "agent"),
      ["org:fulfil_engagements"],
    );

    const person = agency.person("sgp");
    const asked = await hubSent(await hubSend(person, opening, domain));
    const key = orgsIdempotencyKey();
    const acceptedKey = await provider.api.acceptChatRequest(
      colleague.token,
      { request_id: asked.request_id },
      key,
    );
    expect(acceptedKey.status(), await acceptedKey.text()).toBe(200);
    const replayed = await provider.api.acceptChatRequest(
      colleague.token,
      { request_id: asked.request_id },
      key,
    );
    expect(replayed.status(), await replayed.text()).toBe(200);
    // A key stays bound to the request it first answered.
    await expectProblem(
      await provider.api.acceptChatRequest(
        colleague.token,
        { request_id: randomUUID() },
        key,
      ),
      409,
      PROBLEMS.keyConflict,
    );
    const email = await orgEmailText(
      request,
      person.email,
      "accepted your chat request",
    );
    expect(email).toContain(asked.agency_display_name);
    expect(email).not.toContain(colleague.emailAddress);
    expect(email).not.toContain(provider.org.emailAddress);

    // Answered already, the agency's own request, another agency's, and an
    // unknown one.
    const theirs = await sent(
      await agency.send({ address: agency.person("sgp").handle }, opening),
    );
    await withRival(request, agency, "sgp", [opening], async (rival) => {
      const elsewhere = await hubSent(
        await hubSend(agency.person("sgp"), opening, rival.org.domain),
      );
      for (const requestID of [
        asked.request_id,
        theirs.request_id,
        elsewhere.request_id,
        randomUUID(),
      ]) {
        await expectProblem(
          await provider.api.acceptChatRequest(provider.owner, {
            request_id: requestID,
          }),
          404,
          PROBLEMS.orgRequestNotFound,
        );
        await expectProblem(
          await provider.api.declineChatRequest(provider.owner, {
            request_id: requestID,
            scope: "sender",
          }),
          404,
          PROBLEMS.orgRequestNotFound,
        );
      }
    });

    // A decline's key stays bound to the decline it first carried.
    const undecided = agency.person("sgp");
    const pending = await hubSent(await hubSend(undecided, opening, domain));
    const declineKey = orgsIdempotencyKey();
    const declined = await provider.api.declineChatRequest(
      provider.owner,
      { request_id: pending.request_id, scope: "opening" },
      declineKey,
    );
    expect(declined.status(), await declined.text()).toBe(200);
    await expectProblem(
      await provider.api.declineChatRequest(
        provider.owner,
        { request_id: pending.request_id, scope: "sender" },
        declineKey,
      ),
      409,
      PROBLEMS.keyConflict,
    );

    // A deleted person's request cannot be accepted.
    const gone = agency.person("sgp");
    const opened = await sent(
      await agency.send({ address: gone.handle }, opening),
    );
    await accepted(gone, opened);
    await closeForHub(agency, gone, opened.contact_id);
    const late = await hubSent(await hubSend(gone, other, domain));
    deliverAccountDeleted(agency, gone, apiCoverage);
    await expectProblem(
      await provider.api.acceptChatRequest(provider.owner, {
        request_id: late.request_id,
      }),
      409,
      PROBLEMS.orgPartyDeleted,
    );
  });
});

test("MKT-CON-005: a Contact a Hub user's request creates does not count toward the agency's daily Contacts", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening] = agency.openings;
    const today = new Date().toISOString().slice(0, 10);
    sqlScalarForTenant(
      provider.tenant,
      `INSERT INTO vetchium.org_contact_creations (org_did, created_on, created)
       VALUES (${sqlLiteral(agency.did)}::uuid, '${today}'::date, 200)
       ON CONFLICT (org_did, created_on) DO UPDATE SET created = 200`,
    );
    const person = agency.person("sgp");
    const asked = await hubSent(
      await hubSend(person, opening, provider.org.domain),
    );
    await agencyAccepts(agency, asked.request_id);
    await expectProblem(
      await provider.api.addPersonNote(provider.owner, {
        address: agency.person("sgp").alias,
        text: "Over the limit.",
      }),
      429,
      PROBLEMS.orgContactLimit,
    );
  });
});

test("MKT-REQ-005: an agency message while the Hub user's request is pending accepts it", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening, other] = agency.openings;
    const person = agency.person("sgp");
    const first = await sent(
      await agency.send({ address: person.handle }, opening),
    );
    await accepted(person, first);
    await closeForHub(agency, person, first.contact_id);
    const asked = await hubSent(
      await hubSend(person, other, provider.org.domain),
    );

    const message = await provider.api.sendMessage(provider.owner, {
      contact_id: first.contact_id,
      text: "Of course, let us talk.",
    });
    expect(message.status(), await message.text()).toBe(200);
    expect(await atAgency(agency, asked.request_id)).toMatchObject({
      state: "accepted",
    });
    await answeredAt(person, asked, "accepted");
    await awaitChatState(person, other, provider.org.domain, "open");
    const reply = await person.hub.replyToConversation(person.token, {
      contact_id: first.contact_id,
      text: "Great.",
    });
    expect(reply.status(), await reply.text()).toBe(200);
  });
});

test("MKT-REQ-008: with chat requests off the agency may not ask, the Hub user still may, and the accepted conversation continues", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening] = agency.openings;
    const person = agency.person("sgp");
    const off = await person.hub.setAgenciesMayMessage(person.token, {
      agencies_may_message: false,
    });
    expect(off.status(), await off.text()).toBe(204);
    await expectProblem(
      await agency.send({ address: person.handle }, opening),
      403,
      PROBLEMS.orgRequestsOff,
    );

    const asked = await hubSent(
      await hubSend(person, opening, provider.org.domain),
    );
    await agencyAccepts(agency, asked.request_id);
    const message = await provider.api.sendMessage(provider.owner, {
      contact_id: asked.contact_id,
      text: "Welcome.",
    });
    expect(message.status(), await message.text()).toBe(200);
    await awaitChatState(person, opening, provider.org.domain, "open");
    const reply = await person.hub.replyToConversation(person.token, {
      contact_id: asked.contact_id,
      text: "Hello.",
    });
    expect(reply.status(), await reply.text()).toBe(200);
  });
});

test("MKT-REQ-009: a Hub user's request expires after 14 days with no block, and the user may ask again", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening] = agency.openings;
    const domain = provider.org.domain;
    const person = agency.person("sgp");
    const asked = await hubSent(await hubSend(person, opening, domain));
    sqlScalarForTenant(
      provider.tenant,
      `UPDATE vetchium.org_chat_requests
       SET sent_at = now() - interval '15 days'
       WHERE request_id = ${sqlLiteral(asked.request_id)}::uuid`,
    );
    await expect
      .poll(async () => (await atAgency(agency, asked.request_id))?.state, {
        timeout: 30_000,
        intervals: [250, 500, 1000],
      })
      .toBe("expired");
    const expired = await answeredAt(person, asked, "expired");
    expect(expired.decline_scope).toBeUndefined();
    expect(expired.blocked_until).toBeUndefined();
    await awaitChatState(person, opening, domain, "none");
    const again = await hubSent(await hubSend(person, opening, domain));
    expect(again.request_id).not.toBe(asked.request_id);
  });
});

test("MKT-HUB-001: Messages lists a request without a conversation only while it waits for the Hub user or is theirs and unaccepted, and opens the answered one", async ({
  request,
}) => {
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening, other] = agency.openings;
    const person = agency.person("sgp");
    const listed = async (contactID: string) => {
      const response = await person.hub.listConversations(person.token);
      expect(response.status(), await response.text()).toBe(200);
      return ((await response.json()) as ListConversationsResponse).items.some(
        (item) => item.contact_id === contactID,
      );
    };
    const until = (contactID: string, shown: boolean) =>
      expect
        .poll(() => listed(contactID), {
          timeout: 30_000,
          intervals: [250, 500, 1000],
        })
        .toBe(shown);

    // An agency's request shows while pending and leaves once declined.
    const asked = await sent(
      await agency.send({ address: person.handle }, opening),
    );
    await pendingAt(person, asked);
    await until(asked.contact_id, true);
    const declined = await person.hub.declineChatRequest(person.token, {
      request_id: asked.request_id,
      scope: "opening",
    });
    expect(declined.status(), await declined.text()).toBe(200);
    await until(asked.contact_id, false);

    // The Hub user's own request shows while pending and once declined.
    const own = await hubSent(
      await hubSend(person, other, provider.org.domain),
    );
    await until(own.contact_id, true);
    await agencyDeclines(agency, own.request_id, "opening");
    await awaitHubRequest(
      person,
      "to_agency",
      (item) => item.request_id === own.request_id && item.state === "declined",
    );
    expect(await listed(own.contact_id)).toBe(true);
    // Opening it reads the pointer: the agency's tenant has no conversation.
    const read = await person.hub.getConversation(person.token, {
      contact_id: own.contact_id,
    });
    expect(read.status(), await read.text()).toBe(200);
    const detail = (await read.json()) as HubConversationDetail;
    expect(detail.messages).toEqual([]);
    expect(detail.conversation.latest_request?.state).toBe("declined");

    // An accepted request shows as its conversation, and deleting that
    // conversation removes it for good.
    const again = await sent(
      await agency.send({ address: person.handle }, other),
    );
    await accepted(person, again);
    await until(again.contact_id, true);
    const deleted = await person.hub.deleteConversation(person.token, {
      contact_id: again.contact_id,
    });
    expect(deleted.status(), await deleted.text()).toBe(200);
    await until(again.contact_id, false);
  });
});
