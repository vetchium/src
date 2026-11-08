import { randomBytes } from "node:crypto";
import type {
  AwaitingConversationCount,
  HubConversationDetail,
  HubConversationSummary,
  ListConversationsResponse,
} from "typespec/hub/messages/messages";
import type {
  AddedNote,
  AgencyProfile,
  Contact,
  ConversationDetail,
  ConversationMessage,
} from "typespec/orgs/marketplace/contacts/contacts";
import { expectProblem } from "../lib/admin-api.ts";
import {
  AUDIT_FAULT_LOCK,
  auditEventJSONForTenant,
  hubAuditEventsByIdempotencyKey,
  sqlLiteral,
  sqlScalarForTenant,
  type TestTenant,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { cleanupApplicant, seedApplicant } from "../lib/hub-applicant.ts";
import {
  addOrgMember,
  inviteeAddress,
  orgAuditEventsByKey,
  orgDID,
  orgsIdempotencyKey,
} from "../lib/orgs-api.ts";
import { withAgency } from "../lib/orgs-chat-requests.ts";
import {
  activate,
  asProvider,
  awaitHubPointer,
  awaitHubRequest,
  awaitRequestsOff,
  openConversation,
  setOrgHome,
} from "../lib/orgs-marketplace.ts";
import { assign, withWorld } from "../lib/orgs-routing.ts";

const BASE = "vetchium-problem-details/";
const PROBLEMS = {
  notFound: `${BASE}org-hub-user-not-found`,
  contactNotFound: `${BASE}org-contact-not-found`,
  conversationNotFound: `${BASE}org-conversation-not-found`,
  conversationOpen: `${BASE}org-conversation-open`,
  contactLimit: `${BASE}org-contact-limit-reached`,
  listingNotAvailable: `${BASE}org-listing-not-available`,
  agencyRequestsOff: `${BASE}org-agency-requests-off`,
  partyDeleted: `${BASE}org-conversation-party-deleted`,
  permission: `${BASE}org-permission-required`,
  validation: `${BASE}validation-failed`,
  orgTenantUnavailable: `${BASE}org-tenant-unavailable`,

  hubConversationNotFound: `${BASE}hub-conversation-not-found`,
  hubPartyDeleted: `${BASE}hub-conversation-party-deleted`,
  hubOrgUnavailable: `${BASE}hub-org-unavailable`,
  hubMessageNotFound: `${BASE}hub-conversation-message-not-found`,
  messageNotFound: `${BASE}org-conversation-message-not-found`,
};

/**
 * Fails the agency tenant's audit of a Hub user's message deletion for the
 * person `handle`, so the deletion rolls back there. Returns its removal.
 */
function failHubMessageDeletion(tenant: TestTenant, handle: string) {
  const name = `e2e_fail_message_delete_${randomBytes(8).toString("hex")}`;
  sqlScalarForTenant(
    tenant,
    `${AUDIT_FAULT_LOCK}
     CREATE FUNCTION vetchium.${name}() RETURNS trigger LANGUAGE plpgsql
     AS $function$ BEGIN RAISE EXCEPTION 'injected message deletion failure';
     END $function$;
     CREATE TRIGGER ${name} BEFORE INSERT ON vetchium.audit_events
     FOR EACH ROW WHEN (
       NEW.action = 'org.conversation.message_deleted'
       AND NEW.actor_type = 'hub_user'
       AND NEW.entity_id = ${sqlLiteral(handle)}
     ) EXECUTE FUNCTION vetchium.${name}();`,
  );
  return () =>
    sqlScalarForTenant(
      tenant,
      `${AUDIT_FAULT_LOCK}
       DROP TRIGGER ${name} ON vetchium.audit_events;
       DROP FUNCTION vetchium.${name}();`,
    );
}

/** The agency tenant's message-deletion audit payloads for a person. */
function messageDeletedPayloads(tenant: TestTenant, handle: string) {
  return auditEventJSONForTenant(
    tenant,
    `action = 'org.conversation.message_deleted'
     AND entity_id = ${sqlLiteral(handle)}
     AND actor_type = 'hub_user'`,
  ).map((event) => event.payload);
}

test("an accepted chat request opens the conversation; the agency's users share it, and another request is refused while it is open", async ({
  request,
}) => {
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening, other] = agency.openings;
    // Cross-tenant: the agency is in deu, the person in sgp.
    const applicant = agency.person("sgp");

    // 1. The person accepts the agency's request; the request is the
    // conversation's first message.
    const { request: asked } = await openConversation(
      provider,
      applicant,
      opening,
      "Hello! We came across your profile and would love to chat.",
    );
    const handle = asked.hub_user_handle;
    const startRes = await provider.api.getConversation(provider.owner, {
      handle,
    });
    expect(startRes.status(), await startRes.text()).toBe(200);
    const started = (await startRes.json()) as ConversationDetail;
    expect(started.conversation.recorded_hub_user_handle).toBe(
      applicant.handle,
    );
    expect(started.conversation.recorded_hub_user_name).toBe("Ada Applicant");
    expect(started.conversation.recorded_agency_domain).toBe(
      provider.org.domain,
    );
    expect(started.messages).toHaveLength(1);
    expect(started.messages[0]?.sender_type).toBe("agency");
    expect(started.messages[0]?.kind).toBe("request");

    // 2. Shared agency inbox: another member with org:fulfil_engagements
    // writes, and the audit names the message.
    const recruiterAddress = inviteeAddress(provider.org.domain, "recruiter-1");
    const recruiter = await addOrgMember(
      provider.api,
      provider.owner,
      provider.org.domain,
      recruiterAddress,
      ["org:fulfil_engagements"],
    );
    const msgKey = orgsIdempotencyKey();
    const sendRes = await provider.api.sendMessage(
      recruiter.token,
      { handle, text: "Following up from our agency team." },
      msgKey,
    );
    expect(sendRes.status(), await sendRes.text()).toBe(200);
    const sentMsg = (await sendRes.json()) as ConversationMessage;
    expect(sentMsg.sender_type).toBe("agency");
    // An Org user has no display name; the email address stands in.
    expect(sentMsg.sender_display_name).toBe(recruiterAddress);
    expect(sentMsg.text).toBe("Following up from our agency team.");
    expect(
      orgAuditEventsByKey(msgKey, provider.tenant).map((a) => a.action),
    ).toEqual(["org.conversation.message_sent"]);

    // 3. The owner reads both, newest first.
    const getRes = await provider.api.getConversation(provider.owner, {
      handle,
    });
    expect(getRes.status(), await getRes.text()).toBe(200);
    const convDetail = (await getRes.json()) as ConversationDetail;
    expect(convDetail.messages.map((m) => m.kind)).toEqual(["text", "request"]);
    expect(convDetail.messages.map((m) => m.message_number)).toEqual([2, 1]);

    // Any agency user deletes the agency's messages, a colleague's included.
    const colleagueDeleted = await provider.api.deleteMessage(provider.owner, {
      handle,
      message_number: sentMsg.message_number,
    });
    expect(colleagueDeleted.status(), await colleagueDeleted.text()).toBe(200);
    expect(
      ((await colleagueDeleted.json()) as ConversationMessage).deleted,
    ).toBe(true);

    // 4. While the agency may write, it writes instead of asking again.
    await expectProblem(
      await provider.api.sendChatRequest(provider.owner, {
        address: handle,
        suggestion: other,
      }),
      409,
      PROBLEMS.conversationOpen,
    );
  });
});

test("Hub user list, get conversation, mark read, reply, and each side deletes its own messages", async ({
  request,
}) => {
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const applicant = agency.person("sgp");
    {
      // The conversation opens by an accepted request; the agency writes.
      const { request: asked } = await openConversation(
        provider,
        applicant,
        agency.openings[0],
      );
      const handle = asked.hub_user_handle;
      const written = await provider.api.sendMessage(provider.owner, {
        handle,
        text: "Hi Ada, are you open to new opportunities?",
      });
      expect(written.status(), await written.text()).toBe(200);

      // 1. Hub user lists conversations; only the agency's text is unread.
      let list!: ListConversationsResponse;
      await expect
        .poll(
          async () => {
            const listRes = await applicant.hub.listConversations(
              applicant.token,
            );
            if (listRes.status() !== 200) return 0;
            list = (await listRes.json()) as ListConversationsResponse;
            return list.items[0]?.unread_count ?? 0;
          },
          { timeout: 15_000 },
        )
        .toBe(1);
      expect(list.items).toHaveLength(1);
      expect(list.items[0]?.agency_domain).toBe(provider.org.domain);

      // 2. Hub user reads conversation live through mesh
      const getRes = await applicant.hub.getConversation(applicant.token, {
        agency_domain: provider.org.domain,
      });
      expect(getRes.status(), await getRes.text()).toBe(200);
      const hubConv = (await getRes.json()) as HubConversationDetail;
      expect(hubConv.conversation.agency_domain).toBe(provider.org.domain);
      expect(hubConv.messages.map((m) => m.kind)).toEqual(["text", "request"]);
      expect(hubConv.messages[0]?.text).toBe(
        "Hi Ada, are you open to new opportunities?",
      );

      // 3. Hub user marks conversation read
      const markRes = await applicant.hub.markConversationRead(
        applicant.token,
        {
          agency_domain: provider.org.domain,
        },
      );
      expect(markRes.status()).toBe(200);

      // Listing again shows 0 unread
      const listAfterRead = await applicant.hub.listConversations(
        applicant.token,
      );
      const listReadData =
        (await listAfterRead.json()) as ListConversationsResponse;
      expect(listReadData.items[0]?.unread_count).toBe(0);

      // 4. Hub user replies to conversation
      const replyKey = orgsIdempotencyKey();
      const replyRes = await applicant.hub.replyToConversation(
        applicant.token,
        {
          agency_domain: provider.org.domain,
          text: "Yes, I am interested! Please share more details.",
        },
        replyKey,
      );
      expect(replyRes.status(), await replyRes.text()).toBe(200);
      const replyMsg = (await replyRes.json()) as ConversationMessage;
      expect(replyMsg.sender_type).toBe("hub_user");
      expect(replyMsg.text).toBe(
        "Yes, I am interested! Please share more details.",
      );

      // Org side now sees agency_unread: true and the reply message
      const orgGetRes = await provider.api.getConversation(provider.owner, {
        handle,
      });
      expect(orgGetRes.status()).toBe(200);
      const orgConv = (await orgGetRes.json()) as ConversationDetail;
      expect(orgConv.conversation.agency_unread).toBe(true);
      expect(orgConv.messages).toHaveLength(3);
      expect(orgConv.messages[0]?.text).toBe(
        "Yes, I am interested! Please share more details.",
      );

      // Org marks conversation read
      const orgMarkRes = await provider.api.markConversationRead(
        provider.owner,
        {
          handle,
        },
      );
      expect(orgMarkRes.status()).toBe(200);

      const orgGetAfterMark = await provider.api.getConversation(
        provider.owner,
        {
          handle,
        },
      );
      expect(
        ((await orgGetAfterMark.json()) as ConversationDetail).conversation
          .agency_unread,
      ).toBe(false);

      // 5. Each side deletes only its own text messages (MKT-CNV-007):
      // messages 1 (the request) and 2 (the agency's text) are the agency's,
      // 3 is the Hub user's reply.
      await expectProblem(
        await applicant.hub.deleteMessage(applicant.token, {
          agency_domain: provider.org.domain,
          message_number: 2,
        }),
        404,
        PROBLEMS.hubMessageNotFound,
      );
      const hubDeleteKey = orgsIdempotencyKey();
      const hubDeleted = await applicant.hub.deleteMessage(
        applicant.token,
        { agency_domain: provider.org.domain, message_number: 3 },
        hubDeleteKey,
      );
      expect(hubDeleted.status(), await hubDeleted.text()).toBe(200);
      const hubStub = (await hubDeleted.json()) as ConversationMessage;
      expect(hubStub).toMatchObject({
        message_number: 3,
        sender_type: "hub_user",
        kind: "text",
        deleted: true,
      });
      expect(hubStub.text).toBeUndefined();
      // Only the Hub user's tenant keeps what the Hub user wrote.
      expect(
        hubAuditEventsByIdempotencyKey(hubDeleteKey)
          .filter((event) => event.action !== "federation.operation.created")
          .map((event) => [event.action, event.payload]),
      ).toEqual([
        [
          "hub.agency-conversation.message-deleted",
          {
            agency_domain: provider.org.domain,
            message_number: 3,
            deleted_by: "hub_user",
            deleted_text: "Yes, I am interested! Please share more details.",
          },
        ],
      ]);
      expect(messageDeletedPayloads(provider.tenant, applicant.handle)).toEqual(
        [{ message_number: 3, deleted_by: "hub_user" }],
      );
      await expectProblem(
        await applicant.hub.deleteMessage(applicant.token, {
          agency_domain: provider.org.domain,
          message_number: 3,
        }),
        404,
        PROBLEMS.hubMessageNotFound,
      );

      // Any agency user deletes the agency's text, never the request or the
      // Hub user's message.
      for (const number of [1, 3]) {
        await expectProblem(
          await provider.api.deleteMessage(provider.owner, {
            handle,
            message_number: number,
          }),
          404,
          PROBLEMS.messageNotFound,
        );
      }
      const orgDeleteKey = orgsIdempotencyKey();
      const orgDeleted = await provider.api.deleteMessage(
        provider.owner,
        { handle, message_number: 2 },
        orgDeleteKey,
      );
      expect(orgDeleted.status(), await orgDeleted.text()).toBe(200);
      const orgStub = (await orgDeleted.json()) as ConversationMessage;
      expect(orgStub).toMatchObject({
        message_number: 2,
        sender_type: "agency",
        deleted: true,
      });
      expect(orgStub.text).toBeUndefined();
      expect(
        orgAuditEventsByKey(orgDeleteKey, provider.tenant).map((event) => [
          event.action,
          event.payload,
        ]),
      ).toEqual([
        [
          "org.conversation.message_deleted",
          {
            message_number: 2,
            deleted_by: "agency",
            deleted_text: "Hi Ada, are you open to new opportunities?",
          },
        ],
      ]);
      // The Hub user's tenant learns of it without the text.
      await expect
        .poll(
          () =>
            auditEventJSONForTenant(
              applicant.tenant,
              `action = 'hub.agency-conversation.message-deleted'
               AND actor_type = 'org'
               AND subject_hub_user_did = ${sqlLiteral(applicant.did)}::uuid`,
            ).map((event) => event.payload),
          { timeout: 15_000 },
        )
        .toEqual([
          {
            agency_domain: provider.org.domain,
            message_number: 2,
            deleted_by: "agency",
          },
        ]);

      // Both sides read the stubs in place.
      const stubs = (messages: ConversationMessage[]) =>
        messages.map((m) => [m.message_number, m.deleted, m.text ?? m.kind]);
      const orgAfter = (await (
        await provider.api.getConversation(provider.owner, { handle })
      ).json()) as ConversationDetail;
      expect(stubs(orgAfter.messages)).toEqual([
        [3, true, "text"],
        [2, true, "text"],
        [1, false, "request"],
      ]);
      const hubAfter = (await (
        await applicant.hub.getConversation(applicant.token, {
          agency_domain: provider.org.domain,
        })
      ).json()) as HubConversationDetail;
      expect(stubs(hubAfter.messages)).toEqual(stubs(orgAfter.messages));
    }
  });
});

test("agencies may send me chat requests switch refuses new requests while conversations, replies, and the profile view continue", async ({
  request,
}) => {
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening, other] = agency.openings;
    const applicant = agency.person("sgp");
    {
      const viewBefore = await provider.api.viewHubProfile(provider.owner, {
        address: applicant.alias,
      });
      expect(viewBefore.status(), await viewBefore.text()).toBe(200);
      const before = (await viewBefore.json()) as AgencyProfile;

      // 1. The person refuses chat requests from agencies.
      const setOffRes = await applicant.hub.setAgenciesMayMessage(
        applicant.token,
        { agencies_may_message: false },
      );
      expect(setOffRes.status(), await setOffRes.text()).toBe(204);
      const infoRes = await applicant.hub.myInfo(applicant.token);
      expect(infoRes.status()).toBe(200);
      expect(
        ((await infoRes.json()) as { agencies_may_message: boolean })
          .agencies_may_message,
      ).toBe(false);

      // 2. A chat request is refused; the profile stays viewable.
      await expectProblem(
        await provider.api.sendChatRequest(provider.owner, {
          address: applicant.handle,
          suggestion: opening,
        }),
        403,
        PROBLEMS.agencyRequestsOff,
      );
      const viewOff = await provider.api.viewHubProfile(provider.owner, {
        address: applicant.alias,
      });
      expect(viewOff.status(), await viewOff.text()).toBe(200);
      const off = (await viewOff.json()) as AgencyProfile;
      expect(off.profile).toEqual(before.profile);
      expect(off.verified_domains).toEqual(before.verified_domains);

      // 3. With requests on again, an accepted request opens the
      // conversation.
      const setOnRes = await applicant.hub.setAgenciesMayMessage(
        applicant.token,
        { agencies_may_message: true },
      );
      expect(setOnRes.status()).toBe(204);
      const { request: asked } = await openConversation(
        provider,
        applicant,
        other,
      );
      const handle = asked.hub_user_handle;

      // 4. Refusing requests again reaches the agency's Contact once the Hub
      // tenant holds the agency's pointer, and leaves the conversation open.
      await awaitHubPointer(applicant, provider.org.domain);
      const setOffAgain = await applicant.hub.setAgenciesMayMessage(
        applicant.token,
        { agencies_may_message: false },
      );
      expect(setOffAgain.status(), await setOffAgain.text()).toBe(204);
      await awaitRequestsOff(provider.api, provider.owner, handle, true);

      const sendRes = await provider.api.sendMessage(provider.owner, {
        handle,
        text: "Another message while requests are off",
      });
      expect(sendRes.status(), await sendRes.text()).toBe(200);

      const hubGet = await applicant.hub.getConversation(applicant.token, {
        agency_domain: provider.org.domain,
      });
      expect(hubGet.status(), await hubGet.text()).toBe(200);
      expect(
        ((await hubGet.json()) as HubConversationDetail).conversation
          .read_only_reason,
      ).toBeUndefined();
      const replyRes = await applicant.hub.replyToConversation(
        applicant.token,
        {
          agency_domain: provider.org.domain,
          text: "Hub reply while requests are off",
        },
      );
      expect(replyRes.status(), await replyRes.text()).toBe(200);

      const viewContact = await provider.api.viewHubProfile(provider.owner, {
        address: applicant.alias,
      });
      expect(viewContact.status(), await viewContact.text()).toBe(200);
      const withContact = (await viewContact.json()) as AgencyProfile;
      expect(withContact.profile).toEqual(before.profile);
      expect(withContact.contact?.requests_off).toBe(true);
    }
  });
});

test("a chat request about an Opening the agency is not assigned to is refused as invalid", async ({
  request,
}) => {
  await withAgency(request, async (agency) => {
    const { provider, consumer } = agency.pair;
    const applicant = agency.person("sgp");
    for (const suggestion of [
      { consumer_domain: "no-engagement.example.test", opening_number: 9999 },
      { consumer_domain: consumer.org.domain, opening_number: 9999 },
    ]) {
      await expectProblem(
        await provider.api.sendChatRequest(provider.owner, {
          address: applicant.handle,
          suggestion,
        }),
        400,
        PROBLEMS.validation,
      );
    }
  });
});

test("MKT-CNV-003: an agency without a listed sourcing Listing sends no requests, and its conversations continue", async ({
  request,
}) => {
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening, other] = agency.openings;
    const talking = agency.person("sgp", "Tara Talking");
    const asked = agency.person("sgp", "Ari Asked");
    const { request: open } = await openConversation(
      provider,
      talking,
      opening,
    );

    const listings = (await (
      await provider.api.listListings(provider.owner)
    ).json()) as { listings: { capability: string; version: number }[] };
    const sourcing = listings.listings.find(
      (item) => item.capability === "sourcing",
    );
    if (sourcing === undefined) throw new Error("no sourcing Listing");
    const unlisted = await provider.api.unlistListing(provider.owner, {
      capability: "sourcing",
      version: sourcing.version,
    });
    expect(unlisted.status(), await unlisted.text()).toBe(200);

    await expectProblem(
      await provider.api.sendChatRequest(provider.owner, {
        address: asked.handle,
        suggestion: other,
      }),
      409,
      PROBLEMS.listingNotAvailable,
    );
    const written = await provider.api.sendMessage(provider.owner, {
      handle: open.hub_user_handle,
      text: "Still here while we are not listed.",
    });
    expect(written.status(), await written.text()).toBe(200);
    const replied = await talking.hub.replyToConversation(talking.token, {
      agency_domain: provider.org.domain,
      text: "Thanks for following up.",
    });
    expect(replied.status(), await replied.text()).toBe(200);
  });
});

test("counterparty tenant unavailable during Hub conversation get and reply, recovery, and chat-requests switch across tenants", async ({
  request,
}) => {
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const applicant = agency.person("sgp");
    const orgDid = agency.did;
    try {
      // 1. A person in sgp accepts the request of an agency in deu.
      const { request: asked } = await openConversation(
        provider,
        applicant,
        agency.openings[0],
      );
      const handle = asked.hub_user_handle;

      await awaitHubPointer(applicant, provider.org.domain);

      // 2. Hub user opens conversation while agency tenant does not answer -> 503 hub-org-unavailable
      setOrgHome(orgDid, "gone");
      const getGone = await applicant.hub.getConversation(applicant.token, {
        agency_domain: provider.org.domain,
      });
      await expectProblem(getGone, 503, PROBLEMS.hubOrgUnavailable);

      // 3. Hub reply while counterparty route is routed to a tenant that does not home it -> 202, then recovery
      setOrgHome(orgDid, "usa1");
      const replyKey = orgsIdempotencyKey();
      const replyPending = await applicant.hub.replyToConversation(
        applicant.token,
        {
          agency_domain: provider.org.domain,
          text: "Reply while remote route is uncertain",
        },
        replyKey,
      );
      expect(replyPending.status()).toBe(202);
      expect(replyPending.headers()["cache-control"]).toBe("no-store");

      // Restore route to actual tenant: repeat request with same idempotency key recovers -> 200
      setOrgHome(orgDid, provider.tenant);
      const replyRecovered = await applicant.hub.replyToConversation(
        applicant.token,
        {
          agency_domain: provider.org.domain,
          text: "Reply while remote route is uncertain",
        },
        replyKey,
      );
      expect(replyRecovered.status()).toBe(200);

      // 4. Refusing chat requests reaches the agency in another tenant and
      // leaves the conversation open on both sides.
      const setOff = await applicant.hub.setAgenciesMayMessage(
        applicant.token,
        { agencies_may_message: false },
      );
      expect(setOff.status(), await setOff.text()).toBe(204);
      await awaitRequestsOff(provider.api, provider.owner, handle, true);

      const contactRes = await provider.api.getContact(provider.owner, {
        handle,
      });
      expect(contactRes.status()).toBe(200);
      expect(((await contactRes.json()) as Contact).requests_off).toBe(true);

      const agencySend = await provider.api.sendMessage(provider.owner, {
        handle,
        text: "Message while requests are off",
      });
      expect(agencySend.status(), await agencySend.text()).toBe(200);

      const hubGet = await applicant.hub.getConversation(applicant.token, {
        agency_domain: provider.org.domain,
      });
      expect(hubGet.status()).toBe(200);
      const hubConv = (await hubGet.json()) as HubConversationDetail;
      expect(hubConv.conversation.read_only_reason).toBeUndefined();

      const hubReply = await applicant.hub.replyToConversation(
        applicant.token,
        {
          agency_domain: provider.org.domain,
          text: "Hub reply while requests are off",
        },
      );
      expect(hubReply.status(), await hubReply.text()).toBe(200);
    } finally {
      setOrgHome(orgDid, provider.tenant);
    }
  });
});

test("a notes-first Contact's conversation reaches the Hub, a reply keeps its suggestions, and messages page newest first", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer, provider } = pair;
    const sourcing = await activate(pair, "sourcing");
    await asProvider(pair, sourcing.id, sourcing.version);
    await assign(world, sourcing.id);
    const applicant = seedApplicant(request, "sgp");
    const orgDid = orgDID(provider.org.domain, provider.tenant);
    try {
      const noted = await provider.api.addPersonNote(provider.owner, {
        address: applicant.alias,
        text: "Worth a conversation.",
      });
      expect(noted.status(), await noted.text()).toBe(200);
      const handle = ((await noted.json()) as AddedNote).contact.handle;
      expect(handle).toBe(applicant.handle);
      // The note's pointer reaches the Hub, which lists only conversations.
      await expect
        .poll(
          () =>
            sqlScalarForTenant(
              applicant.tenant,
              `SELECT count(*)::text FROM vetchium.hub_agency_pointers
               WHERE hub_user_did = ${sqlLiteral(applicant.did)}::uuid
                 AND agency_org_did = ${sqlLiteral(orgDid)}::uuid`,
            ),
          { timeout: 30_000 },
        )
        .toBe("1");
      const hubList = async () => {
        const listed = await applicant.hub.listConversations(applicant.token);
        expect(listed.status(), await listed.text()).toBe(200);
        return ((await listed.json()) as ListConversationsResponse).items;
      };
      expect(await hubList()).toEqual([]);

      // The accepted request reuses the Contact, and the conversation
      // reaches the Hub as a newer pointer version.
      const { request: asked } = await openConversation(provider, applicant, {
        consumer_domain: consumer.org.domain,
        opening_number: opening.opening_number,
      });
      expect(asked.hub_user_handle).toBe(handle);
      const suggestedOnly = (items: HubConversationSummary[]) =>
        items[0]?.suggestions.map((item) => [
          item.consumer_domain,
          item.opening_number,
        ]);
      await expect
        .poll(async () => suggestedOnly(await hubList()), { timeout: 30_000 })
        .toEqual([[consumer.org.domain, opening.opening_number]]);

      const send = async (text: string) => {
        const sent = await provider.api.sendMessage(provider.owner, {
          handle,
          text,
        });
        expect(sent.status(), await sent.text()).toBe(200);
      };
      await send("First note from us.");
      const replied = await applicant.hub.replyToConversation(applicant.token, {
        agency_domain: provider.org.domain,
        text: "Happy to talk.",
      });
      expect(replied.status(), await replied.text()).toBe(200);
      await send("Great, here are the details.");
      // The last agency message arrives after the reply's pointer update, so
      // an unread pointer has seen the reply too, and kept the suggestion.
      await expect
        .poll(async () => (await hubList())[0]?.unread, { timeout: 30_000 })
        .toBe(true);
      expect(suggestedOnly(await hubList())).toEqual([
        [consumer.org.domain, opening.opening_number],
      ]);

      const texts = (messages: ConversationMessage[]) =>
        messages.map((message) => message.text ?? message.kind);
      const orgFirst = (await (
        await provider.api.getConversation(provider.owner, {
          handle,
          limit: 2,
        })
      ).json()) as ConversationDetail;
      expect(texts(orgFirst.messages)).toEqual([
        "Great, here are the details.",
        "Happy to talk.",
      ]);
      const orgSecond = (await (
        await provider.api.getConversation(provider.owner, {
          handle,
          limit: 2,
          pagination_key: orgFirst.next_pagination_key as string,
        })
      ).json()) as ConversationDetail;
      expect(texts(orgSecond.messages)).toEqual([
        "First note from us.",
        "request",
      ]);
      expect(orgSecond.next_pagination_key).toBeUndefined();

      const hubFirst = await applicant.hub.getConversation(applicant.token, {
        agency_domain: provider.org.domain,
        limit: 3,
      });
      expect(hubFirst.status(), await hubFirst.text()).toBe(200);
      const hubPage = (await hubFirst.json()) as HubConversationDetail;
      expect(texts(hubPage.messages)).toEqual([
        "Great, here are the details.",
        "Happy to talk.",
        "First note from us.",
      ]);
      const hubSecond = (await (
        await applicant.hub.getConversation(applicant.token, {
          agency_domain: provider.org.domain,
          limit: 3,
          pagination_key: hubPage.next_pagination_key as string,
        })
      ).json()) as HubConversationDetail;
      expect(texts(hubSecond.messages)).toEqual(["request"]);
      expect(hubSecond.next_pagination_key).toBeUndefined();
      // Agency messages name the agency on the Hub, never the agency user.
      expect(hubPage.messages[0]?.sender_display_name).not.toContain("@");
    } finally {
      cleanupApplicant(applicant, [
        { tenant: provider.tenant, did: orgDid },
        {
          tenant: consumer.tenant,
          did: orgDID(consumer.org.domain, consumer.tenant),
        },
      ]);
    }
  });
});

test("Hub conversation routes authenticate, validate, and answer for unknown conversations and messages", async ({
  request,
}) => {
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    // Remote, so a delete reads the message across the mesh.
    const applicant = agency.person("sgp");
    const orgDid = agency.did;
    await openConversation(provider, applicant, agency.openings[0]);
    const agency_domain = provider.org.domain;
    await awaitHubPointer(applicant, agency_domain);

    const routes: Array<{ path: string; body: object; write: boolean }> = [
      { path: "/list-conversations", body: {}, write: false },
      { path: "/get-conversation", body: { agency_domain }, write: false },
      {
        path: "/mark-conversation-read",
        body: { agency_domain },
        write: false,
      },
      {
        path: "/reply-to-conversation",
        body: { agency_domain, text: "Hi" },
        write: true,
      },
      {
        path: "/delete-message",
        body: { agency_domain, message_number: 1 },
        write: true,
      },
      {
        path: "/set-agencies-may-message",
        body: { agencies_may_message: true },
        write: false,
      },
    ];
    const keyed = (write: boolean) =>
      write ? { idempotencyKey: orgsIdempotencyKey() } : {};
    for (const entry of routes) {
      await expectProblem(
        await applicant.hub.post(entry.path, entry.body, keyed(entry.write)),
        401,
        `${BASE}hub-authentication-required`,
      );
      await expectProblem(
        await applicant.hub.postRaw(entry.path, "{", {
          token: applicant.token,
          ...keyed(entry.write),
        }),
        400,
        `${BASE}invalid-json`,
      );
    }
    await expectProblem(
      await applicant.hub.get("/count-awaiting-conversations", ""),
      401,
      `${BASE}hub-authentication-required`,
    );
    for (const [path, body, fields] of [
      ["/list-conversations", { limit: 0 }, ["limit"]],
      ["/get-conversation", { agency_domain: "x" }, ["agency_domain"]],
      ["/mark-conversation-read", { agency_domain: "x" }, ["agency_domain"]],
      ["/reply-to-conversation", { agency_domain, text: " " }, ["text"]],
      [
        "/delete-message",
        { agency_domain: "x", message_number: 0 },
        ["agency_domain", "message_number"],
      ],
    ] as const) {
      const write = routes.find((entry) => entry.path === path)?.write;
      await expectProblem(
        await applicant.hub.post(path, body, {
          token: applicant.token,
          ...keyed(write === true),
        }),
        400,
        PROBLEMS.validation,
        [...fields],
      );
    }
    await expectProblem(
      await applicant.hub.post(
        "/set-agencies-may-message",
        {},
        { token: applicant.token },
      ),
      400,
      PROBLEMS.validation,
      ["agencies_may_message"],
    );
    for (const [path, body] of [
      ["/list-conversations", {}],
      ["/get-conversation", { agency_domain }],
    ] as const) {
      await expectProblem(
        await applicant.hub.post(
          path,
          { ...body, pagination_key: "bm90LWEta2V5" },
          { token: applicant.token },
        ),
        400,
        `${BASE}invalid-pagination-key`,
      );
    }
    for (const entry of routes.filter(
      (route) => "agency_domain" in route.body,
    )) {
      await expectProblem(
        await applicant.hub.post(
          entry.path,
          { ...entry.body, agency_domain: "unknown-agency.example.test" },
          { token: applicant.token, ...keyed(entry.write) },
        ),
        404,
        PROBLEMS.hubConversationNotFound,
      );
    }

    // A reply key stays bound to the reply it first carried.
    const key = orgsIdempotencyKey();
    const replied = await applicant.hub.replyToConversation(
      applicant.token,
      { agency_domain, text: "Thanks" },
      key,
    );
    expect(replied.status(), await replied.text()).toBe(200);
    const reply = (await replied.json()) as ConversationMessage;
    await expectProblem(
      await applicant.hub.replyToConversation(
        applicant.token,
        { agency_domain, text: "Something else" },
        key,
      ),
      409,
      `${BASE}idempotency-key-conflict`,
    );

    // A message number the conversation does not have, or one that is not a
    // Hub text, is not the Hub user's to delete.
    for (const number of [1, reply.message_number + 100]) {
      await expectProblem(
        await applicant.hub.deleteMessage(applicant.token, {
          agency_domain,
          message_number: number,
        }),
        404,
        PROBLEMS.hubMessageNotFound,
      );
    }

    // While the agency's tenant does not answer, nothing is deleted.
    setOrgHome(orgDid, "gone");
    try {
      await expectProblem(
        await applicant.hub.deleteMessage(applicant.token, {
          agency_domain,
          message_number: reply.message_number,
        }),
        503,
        PROBLEMS.hubOrgUnavailable,
      );
    } finally {
      setOrgHome(orgDid, provider.tenant);
    }

    // A deletion the agency's tenant fails to confirm is pending, and its
    // repeat completes it.
    const later = await applicant.hub.replyToConversation(applicant.token, {
      agency_domain,
      text: "Pending removal",
    });
    expect(later.status(), await later.text()).toBe(200);
    const laterNumber = ((await later.json()) as ConversationMessage)
      .message_number;
    const pendingKey = orgsIdempotencyKey();
    const removeFault = failHubMessageDeletion(
      provider.tenant,
      applicant.handle,
    );
    try {
      const pending = await applicant.hub.deleteMessage(
        applicant.token,
        { agency_domain, message_number: laterNumber },
        pendingKey,
      );
      expect(pending.status(), await pending.text()).toBe(202);
      expect(pending.headers()["cache-control"]).toBe("no-store");
      expect(
        ((await pending.json()) as { operation_id: string }).operation_id,
      ).toBeTruthy();
    } finally {
      removeFault();
    }
    const completed = await applicant.hub.deleteMessage(
      applicant.token,
      { agency_domain, message_number: laterNumber },
      pendingKey,
    );
    expect(completed.status(), await completed.text()).toBe(200);
    expect(
      ((await completed.json()) as ConversationMessage).message_number,
    ).toBe(laterNumber);

    // A delete key stays bound to the message it first deleted, and its
    // repeat returns the same stub.
    const deleteKey = orgsIdempotencyKey();
    const deleted = await applicant.hub.deleteMessage(
      applicant.token,
      { agency_domain, message_number: reply.message_number },
      deleteKey,
    );
    expect(deleted.status(), await deleted.text()).toBe(200);
    const stub = (await deleted.json()) as ConversationMessage;
    const repeated = await applicant.hub.deleteMessage(
      applicant.token,
      { agency_domain, message_number: reply.message_number },
      deleteKey,
    );
    expect(repeated.status(), await repeated.text()).toBe(200);
    expect(await repeated.json()).toEqual(stub);
    expect(
      hubAuditEventsByIdempotencyKey(deleteKey).map((event) => event.action),
    ).toEqual([
      "federation.operation.created",
      "hub.agency-conversation.message-deleted",
    ]);
    await expectProblem(
      await applicant.hub.deleteMessage(
        applicant.token,
        { agency_domain, message_number: 1 },
        deleteKey,
      ),
      409,
      `${BASE}idempotency-key-conflict`,
    );
  });
});

test("MKT-HUB-001: the Hub counts conversations awaiting the person: requests to answer and unread agency messages", async ({
  request,
}) => {
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening] = agency.openings;
    const applicant = agency.person("sgp");
    const count = async () => {
      const res = await applicant.hub.countAwaitingConversations(
        applicant.token,
      );
      expect(res.status(), await res.text()).toBe(200);
      expect(res.headers()["cache-control"]).toBe("no-store");
      return ((await res.json()) as AwaitingConversationCount).count;
    };
    const awaiting = (expected: number) =>
      expect.poll(count, { timeout: 15_000 }).toBe(expected);
    await awaiting(0);

    // A pending request from the agency awaits an answer.
    const sent = await agency.send({ address: applicant.handle }, opening);
    expect(sent.status(), await sent.text()).toBe(200);
    const pending = await awaitHubRequest(
      applicant,
      "to_hub_user",
      (item) => item.agency_domain === provider.org.domain,
    );
    await awaiting(1);

    // Answered and read, nothing awaits.
    const accepted = await applicant.hub.acceptChatRequest(applicant.token, {
      agency_domain: provider.org.domain,
      request_number: pending.request_number,
    });
    expect(accepted.status(), await accepted.text()).toBe(200);
    const read = async () => {
      const marked = await applicant.hub.markConversationRead(applicant.token, {
        agency_domain: provider.org.domain,
      });
      expect(marked.status(), await marked.text()).toBe(200);
    };
    await read();
    await awaiting(0);

    // Two unread agency messages count once, for their conversation.
    for (const text of ["A first update.", "A second update."]) {
      const written = await provider.api.sendMessage(provider.owner, {
        handle: applicant.handle,
        text,
      });
      expect(written.status(), await written.text()).toBe(200);
    }
    await expect
      .poll(
        async () => {
          const listed = await applicant.hub.listConversations(applicant.token);
          if (listed.status() !== 200) return -1;
          return ((await listed.json()) as ListConversationsResponse).items[0]
            ?.unread_count;
        },
        { timeout: 15_000 },
      )
      .toBe(2);
    expect(await count()).toBe(1);

    // Reading clears it, and the person's own reply never awaits them.
    await read();
    expect(await count()).toBe(0);
    const replied = await applicant.hub.replyToConversation(applicant.token, {
      agency_domain: provider.org.domain,
      text: "Thanks!",
    });
    expect(replied.status(), await replied.text()).toBe(200);
    expect(await count()).toBe(0);
  });
});
