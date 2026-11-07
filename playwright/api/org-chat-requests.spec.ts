import { randomUUID } from "node:crypto";
import type { DeliverEventRequest } from "typespec/federation/events";
import {
  HubAccountAggregate,
  HubAccountDeletedKind,
  HubChatRequestAnswerKind,
} from "typespec/federation/marketplace";
import type {
  HubChatRequest,
  HubConversationDetail,
  ListConversationsResponse,
  ListHubChatRequestsResponse,
} from "typespec/hub/messages/messages";
import type {
  AddedNote,
  ChatRequest,
  Contact,
  PendingChatRequestCount,
} from "typespec/orgs/marketplace/contacts/contacts";
import { expectProblem } from "../lib/admin-api.ts";
import {
  auditEventJSONForTenant,
  sqlLiteral,
  sqlScalarForTenant,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { hubIdempotencyKey } from "../lib/hub-api.ts";
import type { Applicant } from "../lib/hub-applicant.ts";
import { meshPeerRequest } from "../lib/mesh.ts";
import {
  addOrgMember,
  inviteeAddress,
  orgAuditEventsByKey,
  orgDID,
  orgsIdempotencyKey,
} from "../lib/orgs-api.ts";
import {
  type Agency,
  accepted,
  backdate,
  orgConversation,
  orgRequests,
  pendingAt,
  sent,
  withAgency,
} from "../lib/orgs-chat-requests.ts";
import {
  activate,
  asProvider,
  awaitHubPointer,
  awaitHubRequest,
  listing,
  published,
  setOrgHome,
  withProvider,
} from "../lib/orgs-marketplace.ts";

const BASE = "vetchium-problem-details/";
const PROBLEMS = {
  exists: `${BASE}org-chat-request-exists`,
  open: `${BASE}org-conversation-open`,
  blocked: `${BASE}org-chat-request-blocked`,
  limit: `${BASE}org-chat-request-limit-reached`,
  closed: `${BASE}org-conversation-closed`,
  contactLimit: `${BASE}org-contact-limit-reached`,
  partyDeleted: `${BASE}org-conversation-party-deleted`,
  hubUserNotFound: `${BASE}org-hub-user-not-found`,
  contactNotFound: `${BASE}org-contact-not-found`,
  agencyRequestsOff: `${BASE}org-agency-requests-off`,
  permission: `${BASE}org-permission-required`,
  orgAuth: `${BASE}org-authentication-required`,
  validation: `${BASE}validation-failed`,
  invalidJSON: `${BASE}invalid-json`,
  invalidPaginationKey: `${BASE}invalid-pagination-key`,
  keyConflict: `${BASE}idempotency-key-conflict`,
  hubNotFound: `${BASE}hub-chat-request-not-found`,
  hubClosed: `${BASE}hub-conversation-closed`,
  hubAuth: `${BASE}hub-authentication-required`,
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * MKT-REQ-011: the agency's tenant audits the answer with the Contact and the
 * scope, never the note; the Hub user's tenant audits the command under the
 * user's key.
 */
function expectAnswerAudited(
  agency: Agency,
  person: Applicant,
  request: ChatRequest,
  key: string,
  note: string,
): void {
  const answers = auditEventJSONForTenant(
    agency.pair.provider.tenant,
    `entity_type = 'org_chat_request'
     AND entity_id = ${sqlLiteral(request.request_id)}
     AND action IN ('org.chat_request.accepted', 'org.chat_request.declined')`,
  );
  expect(answers).toHaveLength(1);
  expect(answers[0]).toMatchObject({
    actor_type: "hub_user",
    actor_id: person.did,
    payload: { contact_id: request.contact_id, direction: "to_hub_user" },
  });
  expect(JSON.stringify(answers)).not.toContain(note);
  const commands = auditEventJSONForTenant(
    person.tenant,
    `idempotency_key = ${sqlLiteral(key)}
     AND action = 'federation.operation.created'`,
  );
  expect(commands.map((event) => event.payload)).toEqual([
    expect.objectContaining({
      kind: HubChatRequestAnswerKind,
      aggregate_id: request.request_id,
    }),
  ]);
}

test("MKT-REQ-002: an agency sends a request by handle and by Contact; both sides list it, and the note stays with the agency", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening] = agency.openings;
    const byHandle = agency.person("sgp");
    const byContact = agency.person("deu");
    const marker = `note-${randomUUID()}`;

    const key = orgsIdempotencyKey();
    const first = await sent(
      await agency.send({ address: byHandle.handle }, opening, marker, key),
    );
    expect(first).toMatchObject({
      direction: "to_hub_user",
      state: "pending",
      opening,
      note: marker,
      sent_by: provider.org.emailAddress,
      hub_user_name: "Ada Applicant",
      hub_user_handle: byHandle.handle,
    });
    expect(
      orgAuditEventsByKey(key, provider.tenant)
        .map((event) => event.action)
        .sort(),
    ).toEqual(["org.chat_request.sent", "org.contact.created"]);
    // The same key replays the request rather than sending another.
    const replayed = await sent(
      await agency.send({ address: byHandle.handle }, opening, marker, key),
    );
    expect(replayed.request_id).toBe(first.request_id);

    const noted = await provider.api.addPersonNote(provider.owner, {
      address: byContact.alias,
      text: "Met at a meetup.",
    });
    expect(noted.status(), await noted.text()).toBe(200);
    const contactID = ((await noted.json()) as AddedNote).contact.contact_id;
    const second = await sent(
      await agency.send({ contact_id: contactID }, opening),
    );
    expect(second.contact_id).toBe(contactID);
    expect(second.note).toBeUndefined();

    const listed = await orgRequests(agency, "to_hub_user");
    expect(listed.map((item) => item.request_id).sort()).toEqual(
      [first.request_id, second.request_id].sort(),
    );
    expect(await orgRequests(agency, "to_agency")).toEqual([]);
    const count = await provider.api.countPendingChatRequests(provider.owner);
    expect(count.status(), await count.text()).toBe(200);
    expect(count.headers()["cache-control"]).toBe("no-store");
    expect((await count.json()) as PendingChatRequestCount).toEqual({
      count: 0,
    });
    const contact = await provider.api.getContact(provider.owner, {
      contact_id: first.contact_id,
    });
    expect(((await contact.json()) as Contact).latest_request?.request_id).toBe(
      first.request_id,
    );

    // The Hub user sees the request without its note; only the live read of
    // the pair carries it.
    const atHub = await pendingAt(byHandle, first);
    expect(atHub).toMatchObject({
      contact_id: first.contact_id,
      opening,
      agency_domain: provider.org.domain,
      window_days: 90,
    });
    expect(JSON.stringify(atHub)).not.toContain(marker);
    await awaitHubPointer(byHandle, first.contact_id);
    const conversations = await byHandle.hub.listConversations(byHandle.token);
    const pointer = (
      (await conversations.json()) as ListConversationsResponse
    ).items.find((item) => item.contact_id === first.contact_id);
    expect(pointer?.has_conversation).toBe(false);
    expect(pointer?.latest_request?.request_id).toBe(first.request_id);
    expect(JSON.stringify(pointer)).not.toContain(marker);
    const read = await byHandle.hub.getConversation(byHandle.token, {
      contact_id: first.contact_id,
    });
    expect(read.status(), await read.text()).toBe(200);
    const detail = (await read.json()) as HubConversationDetail;
    expect(detail.messages).toEqual([]);
    expect(detail.pending_request_note).toBe(marker);
    await pendingAt(byContact, second);

    for (const tenant of [provider.tenant, byHandle.tenant] as const) {
      expect(
        sqlScalarForTenant(
          tenant,
          `SELECT count(*)::text FROM vetchium.audit_events
           WHERE payload::text LIKE ${sqlLiteral(`%${marker}%`)}`,
        ),
      ).toBe("0");
    }
  });
});

test("MKT-REQ-003: a request is refused while one is pending or the conversation is open, by a decline's block, and first of all for a deleted person", async ({
  request,
  apiCoverage,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening] = agency.openings;
    const person = agency.person("sgp");
    const to = { address: person.handle };

    const first = await sent(await agency.send(to, opening, "Interested?"));
    await expectProblem(await agency.send(to, opening), 409, PROBLEMS.exists);

    await accepted(person, first);
    await expectProblem(await agency.send(to, opening), 409, PROBLEMS.open);

    // Once the person's activity is older than the window, the agency may
    // only ask again.
    backdate(agency, first.contact_id, "hub_activity_at");
    const again = await sent(await agency.send(to, opening));
    await pendingAt(person, again);
    const declined = await person.hub.declineChatRequest(person.token, {
      request_id: again.request_id,
      scope: "opening",
    });
    expect(declined.status(), await declined.text()).toBe(200);
    await expectProblem(await agency.send(to, opening), 403, PROBLEMS.blocked);

    // Account deletion is not built, so its notice is delivered directly.
    const delivered = meshPeerRequest(
      person.tenant,
      provider.tenant,
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
    await expectProblem(
      await agency.send({ contact_id: first.contact_id }, opening),
      409,
      PROBLEMS.partyDeleted,
    );
  });
});

test("MKT-REQ-005: accepting opens the conversation with the request and its Opening as a suggestion, and a later request reopens the same conversation", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const [opening, other] = agency.openings;
    const person = agency.person("deu");
    const to = { address: person.handle };

    const first = await sent(await agency.send(to, opening, "A role for you"));
    const key = hubIdempotencyKey();
    const detail = await accepted(person, first, key);
    // The pointer shows the answer at once, and the same key replays it.
    const listed = await person.hub.listConversations(person.token);
    expect(
      ((await listed.json()) as ListConversationsResponse).items.find(
        (item) => item.contact_id === first.contact_id,
      ),
    ).toMatchObject({
      has_conversation: true,
      latest_request: { request_id: first.request_id, state: "accepted" },
    });
    const replayed = await person.hub.acceptChatRequest(
      person.token,
      { request_id: first.request_id },
      key,
    );
    expect(replayed.status(), await replayed.text()).toBe(200);
    expect(
      ((await replayed.json()) as HubConversationDetail).conversation
        .has_conversation,
    ).toBe(true);
    expectAnswerAudited(agency, person, first, key, "A role for you");
    expect(detail.conversation).toMatchObject({
      contact_id: first.contact_id,
      has_conversation: true,
      latest_request: { request_id: first.request_id, state: "accepted" },
    });
    expect(detail.conversation.suggestions).toEqual([
      expect.objectContaining({ ...opening }),
    ]);
    expect(detail.messages).toEqual([
      expect.objectContaining({
        kind: "request",
        sender_type: "agency",
        suggestion: opening,
        note: "A role for you",
        sent_at: first.sent_at,
      }),
    ]);
    expect(detail.messages[0]?.text).toBeUndefined();
    expect(detail.pending_request_note).toBeUndefined();
    await expectProblem(
      await person.hub.acceptChatRequest(person.token, {
        request_id: first.request_id,
      }),
      404,
      PROBLEMS.hubNotFound,
    );

    const opened = await orgConversation(agency, first.contact_id);
    expect(opened.messages).toEqual([
      expect.objectContaining({ kind: "request", note: "A role for you" }),
    ]);
    const [answered] = await orgRequests(agency, "to_hub_user");
    expect(answered).toMatchObject({ state: "accepted" });
    expect(answered?.note).toBeUndefined();

    backdate(agency, first.contact_id, "hub_activity_at");
    const second = await sent(await agency.send(to, other));
    const reopened = await accepted(person, second);
    expect(reopened.messages.map((message) => message.suggestion)).toEqual([
      other,
      opening,
    ]);
    expect(
      (await orgConversation(agency, first.contact_id)).conversation
        .conversation_id,
    ).toBe(opened.conversation.conversation_id);
  });
});

test("MKT-REQ-007: declining for an Opening refuses only that Opening, and declining the sender refuses every Opening until the block lifts", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening, other] = agency.openings;
    const person = agency.person("sgp");
    const to = { address: person.handle };

    const first = await sent(await agency.send(to, opening, "Private note"));
    await pendingAt(person, first);
    const key = hubIdempotencyKey();
    const declined = await person.hub.declineChatRequest(
      person.token,
      { request_id: first.request_id, scope: "opening" },
      key,
    );
    expect(declined.status(), await declined.text()).toBe(200);
    expect(declined.headers()["cache-control"]).toBe("no-store");
    expectAnswerAudited(agency, person, first, key, "Private note");
    expect((await declined.json()) as HubChatRequest).toMatchObject({
      request_id: first.request_id,
      state: "declined",
      decline_scope: "opening",
      window_days: 90,
    });
    // The note goes with the decline.
    const [answered] = await orgRequests(agency, "to_hub_user");
    expect(answered).toMatchObject({
      state: "declined",
      decline_scope: "opening",
    });
    expect(answered?.note).toBeUndefined();
    await expectProblem(await agency.send(to, opening), 403, PROBLEMS.blocked);

    const second = await sent(await agency.send(to, other));
    await pendingAt(person, second);
    const away = await person.hub.declineChatRequest(person.token, {
      request_id: second.request_id,
      scope: "sender",
    });
    expect(away.status(), await away.text()).toBe(200);
    const blocked = (await away.json()) as HubChatRequest;
    const until = Date.parse(blocked.blocked_until ?? "");
    expect(until).toBeGreaterThan(Date.now() + 89 * DAY);
    expect(until).toBeLessThan(Date.now() + 91 * DAY);
    const latest = (await orgRequests(agency, "to_hub_user")).find(
      (item) => item.request_id === second.request_id,
    );
    expect(latest?.blocked_until).toBe(blocked.blocked_until);
    await expectProblem(await agency.send(to, other), 403, PROBLEMS.blocked);
    await expectProblem(await agency.send(to, opening), 403, PROBLEMS.blocked);

    sqlScalarForTenant(
      provider.tenant,
      `UPDATE vetchium.org_chat_request_blocks
       SET blocked_until = now() - interval '1 minute',
         created_at = now() - interval '91 days'
       WHERE contact_id = ${sqlLiteral(first.contact_id)}::uuid
         AND scope = 'sender'`,
    );
    await sent(await agency.send(to, other));
  });
});

test("MKT-REQ-007: the Hub user who declined the agency may still send the agency a request of their own", async ({
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
    await pendingAt(person, first);
    const declined = await person.hub.declineChatRequest(person.token, {
      request_id: first.request_id,
      scope: "sender",
    });
    expect(declined.status(), await declined.text()).toBe(200);
    await expectProblem(
      await agency.send({ address: person.handle }, other),
      403,
      PROBLEMS.blocked,
    );

    const own = await person.hub.sendChatRequest(person.token, {
      domain: other.consumer_domain,
      opening_number: other.opening_number,
      agency_domain: provider.org.domain,
    });
    expect(own.status(), await own.text()).toBe(200);
    expect((await own.json()) as HubChatRequest).toMatchObject({
      contact_id: first.contact_id,
      direction: "to_agency",
      state: "pending",
      opening: other,
    });
  });
});

test("MKT-REQ-004: each side writes only while the other side's activity plus the window lies ahead", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening] = agency.openings;
    const person = agency.person("deu");
    const first = await sent(
      await agency.send({ address: person.handle }, opening),
    );
    await accepted(person, first);
    const contact_id = first.contact_id;

    const before = (await orgConversation(agency, contact_id)).conversation;
    expect(Date.parse(before.agency_may_write_until ?? "")).toBeGreaterThan(
      Date.now() + 89 * DAY,
    );
    expect(before.hub_may_write_until).toBeDefined();
    // The agency's own messages never extend the agency's window.
    const message = await provider.api.sendMessage(provider.owner, {
      contact_id,
      text: "Here are the details.",
    });
    expect(message.status(), await message.text()).toBe(200);
    const after = (await orgConversation(agency, contact_id)).conversation;
    expect(after.agency_may_write_until).toBe(before.agency_may_write_until);
    expect(Date.parse(after.hub_may_write_until ?? "")).toBeGreaterThanOrEqual(
      Date.parse(before.hub_may_write_until ?? ""),
    );

    // The person went quiet: the agency may not write, the person still may.
    backdate(agency, contact_id, "hub_activity_at");
    const closed = (await orgConversation(agency, contact_id)).conversation;
    expect(closed.agency_may_write_until).toBeUndefined();
    await expectProblem(
      await provider.api.sendMessage(provider.owner, {
        contact_id,
        text: "Anyone there?",
      }),
      409,
      PROBLEMS.closed,
    );
    const replied = await person.hub.replyToConversation(person.token, {
      contact_id,
      text: "Back now.",
    });
    expect(replied.status(), await replied.text()).toBe(200);
    const resumed = await provider.api.sendMessage(provider.owner, {
      contact_id,
      text: "Welcome back.",
    });
    expect(resumed.status(), await resumed.text()).toBe(200);

    // The agency went quiet: the person may not write.
    backdate(agency, contact_id, "agency_activity_at");
    await expectProblem(
      await person.hub.replyToConversation(person.token, {
        contact_id,
        text: "Hello?",
      }),
      409,
      PROBLEMS.hubClosed,
    );
    const hubRead = await person.hub.getConversation(person.token, {
      contact_id,
    });
    expect(hubRead.status(), await hubRead.text()).toBe(200);
    const hubConversation = ((await hubRead.json()) as HubConversationDetail)
      .conversation;
    expect(hubConversation.hub_may_write_until).toBeUndefined();
    expect(hubConversation.agency_may_write_until).toBeDefined();

    // The next Hub command carries the Hub tenant's window, which replaces
    // the stored one.
    sqlScalarForTenant(
      provider.tenant,
      `UPDATE vetchium.org_conversations
       SET window_seconds = 86400, agency_activity_at = now()
       WHERE contact_id = ${sqlLiteral(contact_id)}::uuid`,
    );
    const short = (await orgConversation(agency, contact_id)).conversation;
    expect(Date.parse(short.hub_may_write_until ?? "")).toBeLessThan(
      Date.now() + 2 * DAY,
    );
    const widened = await person.hub.replyToConversation(person.token, {
      contact_id,
      text: "Still interested.",
    });
    expect(widened.status(), await widened.text()).toBe(200);
    const wide = (await orgConversation(agency, contact_id)).conversation;
    expect(Date.parse(wide.hub_may_write_until ?? "")).toBeGreaterThan(
      Date.now() + 89 * DAY,
    );
    expect(Date.parse(wide.agency_may_write_until ?? "")).toBeGreaterThan(
      Date.now() + 89 * DAY,
    );
  });
});

test("MKT-REQ-005: a Hub reply while the agency's request is pending accepts it first", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const [opening, other] = agency.openings;
    const person = agency.person("sgp");
    const to = { address: person.handle };
    const first = await sent(await agency.send(to, opening));
    await accepted(person, first);
    backdate(agency, first.contact_id, "hub_activity_at");
    const second = await sent(await agency.send(to, other, "One more role"));
    await pendingAt(person, second);

    const replied = await person.hub.replyToConversation(person.token, {
      contact_id: first.contact_id,
      text: "Tell me more.",
    });
    expect(replied.status(), await replied.text()).toBe(200);
    expect(
      (await orgRequests(agency, "to_hub_user")).find(
        (item) => item.request_id === second.request_id,
      )?.state,
    ).toBe("accepted");
    const messages = (await orgConversation(agency, first.contact_id)).messages;
    expect(
      messages.map((message) => message.text ?? message.note ?? message.kind),
    ).toEqual(["Tell me more.", "One more role", "request"]);
  });
});

test("MKT-REQ-006: an agency sends at most 50 requests a UTC day, and a declined one still counts", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const [opening] = agency.openings;
    const first = agency.person("sgp");
    const second = agency.person("sgp");
    const today = new Date().toISOString().slice(0, 10);
    sqlScalarForTenant(
      agency.pair.provider.tenant,
      `INSERT INTO vetchium.org_chat_request_creations (org_did, created_on, created)
       VALUES (${sqlLiteral(agency.did)}::uuid, '${today}'::date, 49)
       ON CONFLICT (org_did, created_on) DO UPDATE SET created = 49`,
    );
    const last = await sent(
      await agency.send({ address: first.handle }, opening),
    );
    await pendingAt(first, last);
    const declined = await first.hub.declineChatRequest(first.token, {
      request_id: last.request_id,
      scope: "opening",
    });
    expect(declined.status(), await declined.text()).toBe(200);
    await expectProblem(
      await agency.send({ address: second.handle }, opening),
      429,
      PROBLEMS.limit,
    );
  });
});

test("MKT-CON-005: a Contact a request creates counts toward the agency's daily Contacts", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening] = agency.openings;
    const first = agency.person("sgp");
    const second = agency.person("sgp");
    const today = new Date().toISOString().slice(0, 10);
    sqlScalarForTenant(
      provider.tenant,
      `INSERT INTO vetchium.org_contact_creations (org_did, created_on, created)
       VALUES (${sqlLiteral(agency.did)}::uuid, '${today}'::date, 199)
       ON CONFLICT (org_did, created_on) DO UPDATE SET created = 199`,
    );
    await sent(await agency.send({ address: first.handle }, opening));
    await expectProblem(
      await agency.send({ address: second.handle }, opening),
      429,
      PROBLEMS.contactLimit,
    );
    await expectProblem(
      await provider.api.addPersonNote(provider.owner, {
        address: second.alias,
        text: "Over the limit.",
      }),
      429,
      PROBLEMS.contactLimit,
    );
  });
});

test("Orgs chat request routes, answers included, authenticate, require org:fulfil_engagements, validate, and name unknown people", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening] = agency.openings;
    const person = agency.person("sgp");
    const helper = await addOrgMember(
      provider.api,
      provider.owner,
      provider.org.domain,
      inviteeAddress(provider.org.domain, "viewer"),
      ["org:view_openings"],
    );

    const routes = [
      {
        path: "/send-chat-request",
        body: { address: person.handle, suggestion: opening },
        write: true,
      },
      {
        path: "/list-chat-requests",
        body: { direction: "to_hub_user" },
        write: false,
      },
      {
        path: "/accept-chat-request",
        body: { request_id: randomUUID() },
        write: true,
      },
      {
        path: "/decline-chat-request",
        body: { request_id: randomUUID(), scope: "opening" },
        write: true,
      },
    ];
    const keyed = (write: boolean) =>
      write ? { idempotencyKey: orgsIdempotencyKey() } : {};
    for (const route of routes) {
      await expectProblem(
        await provider.api.post(route.path, route.body, keyed(route.write)),
        401,
        PROBLEMS.orgAuth,
      );
      await expectProblem(
        await provider.api.post(route.path, route.body, {
          token: helper.token,
          ...keyed(route.write),
        }),
        403,
        PROBLEMS.permission,
      );
      await expectProblem(
        await provider.api.postRaw(route.path, "{", {
          token: provider.owner,
          ...keyed(route.write),
        }),
        400,
        PROBLEMS.invalidJSON,
      );
    }
    await expectProblem(
      await provider.api.countPendingChatRequests(),
      401,
      PROBLEMS.orgAuth,
    );
    await expectProblem(
      await provider.api.countPendingChatRequests(helper.token),
      403,
      PROBLEMS.permission,
    );

    await expectProblem(
      await provider.api.post(
        "/send-chat-request",
        { suggestion: opening },
        { token: provider.owner, idempotencyKey: orgsIdempotencyKey() },
      ),
      400,
      PROBLEMS.validation,
    );
    await expectProblem(
      await provider.api.post(
        "/list-chat-requests",
        { direction: "sideways" },
        { token: provider.owner },
      ),
      400,
      PROBLEMS.validation,
      ["direction"],
    );
    for (const [path, body, fields] of [
      ["/accept-chat-request", { request_id: "x" }, ["request_id"]],
      [
        "/decline-chat-request",
        { request_id: "x", scope: "forever" },
        ["request_id", "scope"],
      ],
    ] as const) {
      await expectProblem(
        await provider.api.post(path, body, {
          token: provider.owner,
          idempotencyKey: orgsIdempotencyKey(),
        }),
        400,
        PROBLEMS.validation,
        [...fields],
      );
    }
    await expectProblem(
      await provider.api.listChatRequests(provider.owner, {
        direction: "to_hub_user",
        pagination_key: "not-a-key",
      }),
      400,
      PROBLEMS.invalidPaginationKey,
    );
    await expectProblem(
      await agency.send({ address: "e2e-00000000000000000000" }, opening),
      404,
      PROBLEMS.hubUserNotFound,
    );
    await expectProblem(
      await agency.send({ contact_id: randomUUID() }, opening),
      404,
      PROBLEMS.contactNotFound,
    );

    const off = await person.hub.setAgenciesMayMessage(person.token, {
      agencies_may_message: false,
    });
    expect(off.status(), await off.text()).toBe(204);
    await expectProblem(
      await agency.send({ address: person.handle }, opening),
      403,
      PROBLEMS.agencyRequestsOff,
    );

    // A key stays bound to the request it first carried.
    const other = agency.person("sgp");
    const key = orgsIdempotencyKey();
    await sent(await agency.send({ address: other.handle }, opening, "A", key));
    await expectProblem(
      await agency.send({ address: other.handle }, opening, "B", key),
      409,
      PROBLEMS.keyConflict,
    );
  });
});

test("Hub chat request routes authenticate, validate, page, and answer only pending requests to the user", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const [opening, other] = agency.openings;
    const person = agency.person("sgp");
    const stranger = agency.person("sgp");
    const first = await sent(
      await agency.send({ address: person.handle }, opening),
    );
    await pendingAt(person, first);

    const routes = [
      {
        path: "/list-chat-requests",
        body: { direction: "to_hub_user" },
        write: false,
      },
      {
        path: "/accept-chat-request",
        body: { request_id: first.request_id },
        write: true,
      },
      {
        path: "/decline-chat-request",
        body: { request_id: first.request_id, scope: "opening" },
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
        "/list-chat-requests",
        { direction: "x", limit: 0 },
        ["direction", "limit"],
        false,
      ],
      ["/accept-chat-request", { request_id: "x" }, ["request_id"], true],
      [
        "/decline-chat-request",
        { request_id: "x", scope: "forever" },
        ["request_id", "scope"],
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
    await expectProblem(
      await person.hub.listChatRequests(person.token, {
        direction: "to_hub_user",
        pagination_key: "not-a-key",
      }),
      400,
      PROBLEMS.invalidPaginationKey,
    );
    // Another person's request, and an unknown one, are not found.
    for (const answer of [
      () =>
        stranger.hub.acceptChatRequest(stranger.token, {
          request_id: first.request_id,
        }),
      () =>
        stranger.hub.declineChatRequest(stranger.token, {
          request_id: first.request_id,
          scope: "sender",
        }),
      () =>
        person.hub.acceptChatRequest(person.token, {
          request_id: randomUUID(),
        }),
    ]) {
      await expectProblem(await answer(), 404, PROBLEMS.hubNotFound);
    }

    // Pages: the pending request first, then the answered one.
    const declineKey = hubIdempotencyKey();
    const declined = await person.hub.declineChatRequest(
      person.token,
      { request_id: first.request_id, scope: "opening" },
      declineKey,
    );
    expect(declined.status(), await declined.text()).toBe(200);
    await expectProblem(
      await person.hub.declineChatRequest(
        person.token,
        { request_id: first.request_id, scope: "sender" },
        declineKey,
      ),
      409,
      PROBLEMS.keyConflict,
    );
    await awaitHubRequest(
      person,
      "to_hub_user",
      (item) =>
        item.request_id === first.request_id && item.state === "declined",
    );
    // The pointer keeps only the latest request with each agency, so a
    // second agency pages against the first.
    const { consumer } = agency.pair;
    await withProvider(request, async (rival) => {
      const pair = { consumer, provider: rival };
      await published(rival.api, rival.owner, listing("sourcing", "Sourcing"));
      const sourcing = await activate(pair, "sourcing");
      await asProvider(pair, sourcing.id, sourcing.version);
      const assigned = await consumer.api.assignOpeningProvider(
        consumer.owner,
        {
          opening_number: other.opening_number,
          engagement_id: sourcing.id,
        },
      );
      expect(assigned.status(), await assigned.text()).toBe(200);
      agency.orgs.push({
        tenant: rival.tenant,
        did: orgDID(rival.org.domain, rival.tenant),
      });
      const second = await sent(
        await rival.api.sendChatRequest(rival.owner, {
          address: person.handle,
          suggestion: other,
        }),
      );
      await pendingAt(person, second);
      const page = await person.hub.listChatRequests(person.token, {
        direction: "to_hub_user",
        limit: 1,
      });
      expect(page.status(), await page.text()).toBe(200);
      expect(page.headers()["cache-control"]).toBe("no-store");
      const firstPage = (await page.json()) as ListHubChatRequestsResponse;
      expect(firstPage.items.map((item) => item.request_id)).toEqual([
        second.request_id,
      ]);
      expect(firstPage.next_pagination_key).toBeDefined();
      const rest = await person.hub.listChatRequests(person.token, {
        direction: "to_hub_user",
        limit: 1,
        pagination_key: firstPage.next_pagination_key as string,
      });
      expect(rest.status(), await rest.text()).toBe(200);
      const lastPage = (await rest.json()) as ListHubChatRequestsResponse;
      expect(lastPage.items.map((item) => item.request_id)).toEqual([
        first.request_id,
      ]);
      expect(lastPage.next_pagination_key).toBeUndefined();
    });
    const toAgency = await person.hub.listChatRequests(person.token, {
      direction: "to_agency",
    });
    expect(((await toAgency.json()) as { items: unknown[] }).items).toEqual([]);
  });
});

test("MKT-TST-002: an accept or decline the agency's tenant cannot confirm is pending, and its repeat completes", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening] = agency.openings;
    const accepting = agency.person("sgp");
    const declining = agency.person("sgp");
    const toAccept = await sent(
      await agency.send({ address: accepting.handle }, opening),
    );
    const toDecline = await sent(
      await agency.send({ address: declining.handle }, opening),
    );
    await pendingAt(accepting, toAccept);
    await pendingAt(declining, toDecline);

    const acceptKey = hubIdempotencyKey();
    const declineKey = hubIdempotencyKey();
    setOrgHome(agency.did, "usa1");
    try {
      for (const pending of [
        await accepting.hub.acceptChatRequest(
          accepting.token,
          { request_id: toAccept.request_id },
          acceptKey,
        ),
        await declining.hub.declineChatRequest(
          declining.token,
          { request_id: toDecline.request_id, scope: "sender" },
          declineKey,
        ),
      ]) {
        expect(pending.status(), await pending.text()).toBe(202);
        expect(pending.headers()["cache-control"]).toBe("no-store");
        expect(
          ((await pending.json()) as { operation_id: string }).operation_id,
        ).toBeTruthy();
      }
    } finally {
      setOrgHome(agency.did, provider.tenant);
    }
    const acceptedNow = await accepting.hub.acceptChatRequest(
      accepting.token,
      { request_id: toAccept.request_id },
      acceptKey,
    );
    expect(acceptedNow.status(), await acceptedNow.text()).toBe(200);
    expect(
      ((await acceptedNow.json()) as HubConversationDetail).conversation
        .has_conversation,
    ).toBe(true);
    const declinedNow = await declining.hub.declineChatRequest(
      declining.token,
      { request_id: toDecline.request_id, scope: "sender" },
      declineKey,
    );
    expect(declinedNow.status(), await declinedNow.text()).toBe(200);
    expect((await declinedNow.json()) as HubChatRequest).toMatchObject({
      state: "declined",
      decline_scope: "sender",
    });
  });
});
