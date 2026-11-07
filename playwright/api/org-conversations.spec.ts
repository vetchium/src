import { randomUUID } from "node:crypto";
import type {
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
import { sqlScalarForTenant } from "../lib/admin-db.ts";
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
};

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
    const contactID = asked.contact_id;
    const startRes = await provider.api.getConversation(provider.owner, {
      contact_id: contactID,
    });
    expect(startRes.status(), await startRes.text()).toBe(200);
    const started = (await startRes.json()) as ConversationDetail;
    expect(started.conversation.conversation_id).toBeTruthy();
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
      { contact_id: contactID, text: "Following up from our agency team." },
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
      contact_id: contactID,
    });
    expect(getRes.status(), await getRes.text()).toBe(200);
    const convDetail = (await getRes.json()) as ConversationDetail;
    expect(convDetail.messages.map((m) => m.kind)).toEqual(["text", "request"]);
    expect(convDetail.conversation.conversation_id).toBe(
      started.conversation.conversation_id,
    );

    // 4. While the agency may write, it writes instead of asking again.
    await expectProblem(
      await provider.api.sendChatRequest(provider.owner, {
        contact_id: contactID,
        suggestion: other,
      }),
      409,
      PROBLEMS.conversationOpen,
    );
  });
});

test("Hub user list, get conversation, mark read, reply, and delete", async ({
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
      const contactID = asked.contact_id;
      const written = await provider.api.sendMessage(provider.owner, {
        contact_id: contactID,
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
      expect(list.items[0]?.contact_id).toBe(contactID);
      expect(list.items[0]?.agency_domain).toBe(provider.org.domain);

      // 2. Hub user reads conversation live through mesh
      const getRes = await applicant.hub.getConversation(applicant.token, {
        contact_id: contactID,
      });
      expect(getRes.status(), await getRes.text()).toBe(200);
      const hubConv = (await getRes.json()) as HubConversationDetail;
      expect(hubConv.conversation.contact_id).toBe(contactID);
      expect(hubConv.messages.map((m) => m.kind)).toEqual(["text", "request"]);
      expect(hubConv.messages[0]?.text).toBe(
        "Hi Ada, are you open to new opportunities?",
      );

      // 3. Hub user marks conversation read
      const markRes = await applicant.hub.markConversationRead(
        applicant.token,
        {
          contact_id: contactID,
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
          contact_id: contactID,
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
        contact_id: contactID,
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
          contact_id: contactID,
        },
      );
      expect(orgMarkRes.status()).toBe(200);

      const orgGetAfterMark = await provider.api.getConversation(
        provider.owner,
        {
          contact_id: contactID,
        },
      );
      expect(
        ((await orgGetAfterMark.json()) as ConversationDetail).conversation
          .agency_unread,
      ).toBe(false);

      // A note keeps the Contact once the conversation is gone.
      const noted = await provider.api.addContactNote(provider.owner, {
        contact_id: contactID,
        text: "Interested; follow up next week.",
      });
      expect(noted.status(), await noted.text()).toBe(200);
      const noteID = ((await noted.json()) as AddedNote).note.note_id;

      // 5. Hub user deletes conversation
      const deleteKey = orgsIdempotencyKey();
      const deleteRes = await applicant.hub.deleteConversation(
        applicant.token,
        {
          contact_id: contactID,
        },
        deleteKey,
      );
      expect(deleteRes.status(), await deleteRes.text()).toBe(200);

      // Hub reading conversation now gives 404
      const getAfterDelete = await applicant.hub.getConversation(
        applicant.token,
        {
          contact_id: contactID,
        },
      );
      await expectProblem(
        getAfterDelete,
        404,
        PROBLEMS.hubConversationNotFound,
      );

      // Hub listConversations now empty
      await expect
        .poll(
          async () => {
            const listAfterDelete = await applicant.hub.listConversations(
              applicant.token,
            );
            if (listAfterDelete.status() !== 200) return -1;
            return ((await listAfterDelete.json()) as ListConversationsResponse)
              .items.length;
          },
          { timeout: 15_000 },
        )
        .toBe(0);

      // The Contact remains with its note (MKT-CON-004); the conversation is
      // gone.
      const contactAfterDelete = await provider.api.getContact(provider.owner, {
        contact_id: contactID,
      });
      expect(contactAfterDelete.status()).toBe(200);
      expect(
        ((await contactAfterDelete.json()) as Contact).has_conversation,
      ).toBe(false);
      const orgGetAfterDelete = await provider.api.getConversation(
        provider.owner,
        {
          contact_id: contactID,
        },
      );
      await expectProblem(
        orgGetAfterDelete,
        404,
        PROBLEMS.conversationNotFound,
      );

      // Deleting the last note deletes the Contact, now holding neither.
      const noteDeleted = await provider.api.deleteContactNote(provider.owner, {
        contact_id: contactID,
        note_id: noteID,
      });
      expect(noteDeleted.status(), await noteDeleted.text()).toBe(200);
      await expectProblem(
        await provider.api.getContact(provider.owner, {
          contact_id: contactID,
        }),
        404,
        PROBLEMS.contactNotFound,
      );
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
      const contactID = asked.contact_id;

      // 4. Refusing requests again reaches the agency's Contact once the Hub
      // tenant holds the agency's pointer, and leaves the conversation open.
      await awaitHubPointer(applicant, contactID);
      const setOffAgain = await applicant.hub.setAgenciesMayMessage(
        applicant.token,
        { agencies_may_message: false },
      );
      expect(setOffAgain.status(), await setOffAgain.text()).toBe(204);
      await awaitRequestsOff(provider.api, provider.owner, contactID, true);

      const sendRes = await provider.api.sendMessage(provider.owner, {
        contact_id: contactID,
        text: "Another message while requests are off",
      });
      expect(sendRes.status(), await sendRes.text()).toBe(200);

      const hubGet = await applicant.hub.getConversation(applicant.token, {
        contact_id: contactID,
      });
      expect(hubGet.status(), await hubGet.text()).toBe(200);
      expect(
        ((await hubGet.json()) as HubConversationDetail).conversation
          .read_only_reason,
      ).toBeUndefined();
      const replyRes = await applicant.hub.replyToConversation(
        applicant.token,
        { contact_id: contactID, text: "Hub reply while requests are off" },
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
      contact_id: open.contact_id,
      text: "Still here while we are not listed.",
    });
    expect(written.status(), await written.text()).toBe(200);
    const replied = await talking.hub.replyToConversation(talking.token, {
      contact_id: open.contact_id,
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
      const contactID = asked.contact_id;

      await awaitHubPointer(applicant, contactID);

      // 2. Hub user opens conversation while agency tenant does not answer -> 503 hub-org-unavailable
      setOrgHome(orgDid, "gone");
      const getGone = await applicant.hub.getConversation(applicant.token, {
        contact_id: contactID,
      });
      await expectProblem(getGone, 503, PROBLEMS.hubOrgUnavailable);

      // 3. Hub reply while counterparty route is routed to a tenant that does not home it -> 202, then recovery
      setOrgHome(orgDid, "usa1");
      const replyKey = orgsIdempotencyKey();
      const replyPending = await applicant.hub.replyToConversation(
        applicant.token,
        {
          contact_id: contactID,
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
          contact_id: contactID,
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
      await awaitRequestsOff(provider.api, provider.owner, contactID, true);

      const contactRes = await provider.api.getContact(provider.owner, {
        contact_id: contactID,
      });
      expect(contactRes.status()).toBe(200);
      expect(((await contactRes.json()) as Contact).requests_off).toBe(true);

      const agencySend = await provider.api.sendMessage(provider.owner, {
        contact_id: contactID,
        text: "Message while requests are off",
      });
      expect(agencySend.status(), await agencySend.text()).toBe(200);

      const hubGet = await applicant.hub.getConversation(applicant.token, {
        contact_id: contactID,
      });
      expect(hubGet.status()).toBe(200);
      const hubConv = (await hubGet.json()) as HubConversationDetail;
      expect(hubConv.conversation.read_only_reason).toBeUndefined();

      const hubReply = await applicant.hub.replyToConversation(
        applicant.token,
        { contact_id: contactID, text: "Hub reply while requests are off" },
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
      const contactID = ((await noted.json()) as AddedNote).contact.contact_id;
      // The note's pointer reaches the Hub, which lists only conversations.
      await expect
        .poll(
          () =>
            sqlScalarForTenant(
              applicant.tenant,
              `SELECT count(*)::text FROM vetchium.hub_agency_pointers
               WHERE contact_id = '${contactID}'`,
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
      expect(asked.contact_id).toBe(contactID);
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
          contact_id: contactID,
          text,
        });
        expect(sent.status(), await sent.text()).toBe(200);
      };
      await send("First note from us.");
      const replied = await applicant.hub.replyToConversation(applicant.token, {
        contact_id: contactID,
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
          contact_id: contactID,
          limit: 2,
        })
      ).json()) as ConversationDetail;
      expect(texts(orgFirst.messages)).toEqual([
        "Great, here are the details.",
        "Happy to talk.",
      ]);
      const orgSecond = (await (
        await provider.api.getConversation(provider.owner, {
          contact_id: contactID,
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
        contact_id: contactID,
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
          contact_id: contactID,
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

test("Hub conversation routes authenticate, validate, and answer for unknown conversations", async ({
  request,
}) => {
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    // Remote, so a delete crosses the mesh and may be pending.
    const applicant = agency.person("sgp");
    const orgDid = agency.did;
    {
      const { request: asked } = await openConversation(
        provider,
        applicant,
        agency.openings[0],
      );
      const contact_id = asked.contact_id;
      await awaitHubPointer(applicant, contact_id);

      const routes: Array<{ path: string; body: object; write: boolean }> = [
        { path: "/list-conversations", body: {}, write: false },
        { path: "/get-conversation", body: { contact_id }, write: false },
        { path: "/mark-conversation-read", body: { contact_id }, write: false },
        {
          path: "/reply-to-conversation",
          body: { contact_id, text: "Hi" },
          write: true,
        },
        { path: "/delete-conversation", body: { contact_id }, write: true },
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
      for (const [path, body, fields] of [
        ["/list-conversations", { limit: 0 }, ["limit"]],
        ["/get-conversation", { contact_id: "x" }, ["contact_id"]],
        ["/mark-conversation-read", { contact_id: "x" }, ["contact_id"]],
        ["/reply-to-conversation", { contact_id, text: " " }, ["text"]],
        ["/delete-conversation", { contact_id: "x" }, ["contact_id"]],
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
      for (const entry of routes.filter(
        (route) => "contact_id" in route.body,
      )) {
        await expectProblem(
          await applicant.hub.post(
            entry.path,
            { ...entry.body, contact_id: randomUUID() },
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
        { contact_id, text: "Thanks" },
        key,
      );
      expect(replied.status(), await replied.text()).toBe(200);
      await expectProblem(
        await applicant.hub.replyToConversation(
          applicant.token,
          { contact_id, text: "Something else" },
          key,
        ),
        409,
        `${BASE}idempotency-key-conflict`,
      );

      // A delete the agency's tenant cannot confirm is pending, and its
      // repeat with the same key completes once the route is right.
      setOrgHome(orgDid, "usa1");
      const deleteKey = orgsIdempotencyKey();
      try {
        const pending = await applicant.hub.deleteConversation(
          applicant.token,
          { contact_id },
          deleteKey,
        );
        expect(pending.status(), await pending.text()).toBe(202);
        expect(pending.headers()["cache-control"]).toBe("no-store");
      } finally {
        setOrgHome(orgDid, provider.tenant);
      }
      const deleted = await applicant.hub.deleteConversation(
        applicant.token,
        { contact_id },
        deleteKey,
      );
      expect(deleted.status(), await deleted.text()).toBe(200);
    }
  });
});
