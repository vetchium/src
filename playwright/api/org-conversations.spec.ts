import { randomUUID } from "node:crypto";
import type {
  HubConversationDetail,
  HubConversationSummary,
  ListConversationsResponse,
} from "typespec/hub/messages/messages";
import type {
  AddedNote,
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
import {
  activate,
  asProvider,
  awaitHubPointer,
  awaitMessagesOff,
  listing,
  published,
  setOrgHome,
  withProvider,
} from "../lib/orgs-marketplace.ts";
import { assign, withWorld } from "../lib/orgs-routing.ts";

const BASE = "vetchium-problem-details/";
const PROBLEMS = {
  notFound: `${BASE}org-hub-user-not-found`,
  contactNotFound: `${BASE}org-contact-not-found`,
  conversationNotFound: `${BASE}org-conversation-not-found`,
  conversationLimit: `${BASE}org-conversation-limit-reached`,
  contactLimit: `${BASE}org-contact-limit-reached`,
  listingNotAvailable: `${BASE}org-listing-not-available`,
  agencyMessagesOff: `${BASE}org-agency-messages-off`,
  partyDeleted: `${BASE}org-conversation-party-deleted`,
  permission: `${BASE}org-permission-required`,
  validation: `${BASE}validation-failed`,
  orgTenantUnavailable: `${BASE}org-tenant-unavailable`,

  hubConversationNotFound: `${BASE}hub-conversation-not-found`,
  hubAgencyMessagesOff: `${BASE}hub-agency-messages-off`,
  hubPartyDeleted: `${BASE}hub-conversation-party-deleted`,
  hubOrgUnavailable: `${BASE}hub-org-unavailable`,
};

test("agency starts conversation, sends messages, idempotency, shared inbox, and audit events", async ({
  request,
}) => {
  await withProvider(request, async (provider) => {
    await published(
      provider.api,
      provider.owner,
      listing("sourcing", "Agency Sourcing"),
    );

    // Cross-tenant: provider in sgp, applicant in deu
    const applicant = seedApplicant(request, "deu");
    const orgDid = orgDID(provider.org.domain, provider.tenant);

    try {
      // 1. Agency starts conversation with applicant
      const startKey = orgsIdempotencyKey();
      const startRes = await provider.api.startConversation(
        provider.owner,
        {
          address: applicant.alias,
          text: "Hello! We came across your profile and would love to chat.",
        },
        startKey,
      );
      expect(startRes.status(), await startRes.text()).toBe(200);
      const started = (await startRes.json()) as ConversationDetail;

      expect(started.conversation.contact_id).toBeTruthy();
      expect(started.conversation.conversation_id).toBeTruthy();
      expect(started.conversation.recorded_hub_user_name).toBe("Ada Applicant");
      expect(started.conversation.recorded_agency_domain).toBe(
        provider.org.domain,
      );
      expect(started.conversation.agency_unread).toBe(false);
      expect(started.messages).toHaveLength(1);
      expect(started.messages[0]?.sender_type).toBe("agency");
      expect(started.messages[0]?.kind).toBe("text");
      expect(started.messages[0]?.text).toBe(
        "Hello! We came across your profile and would love to chat.",
      );

      const contactID = started.conversation.contact_id;
      const conversationID = started.conversation.conversation_id;

      // 2. Idempotent replay of start conversation
      const replayRes = await provider.api.startConversation(
        provider.owner,
        {
          address: applicant.alias,
          text: "Hello! We came across your profile and would love to chat.",
        },
        startKey,
      );
      expect(replayRes.status()).toBe(200);
      const replayed = (await replayRes.json()) as ConversationDetail;
      expect(replayed.conversation.conversation_id).toBe(conversationID);
      expect(replayed.messages[0]?.message_id).toBe(
        started.messages[0]?.message_id,
      );

      // Audit logs for start conversation
      const audits = orgAuditEventsByKey(startKey, provider.tenant);
      expect(audits.map((a) => a.action).sort()).toEqual([
        "org.contact.created",
        "org.conversation.created",
        "org.conversation.message_sent",
      ]);

      // 3. Shared agency inbox: another member with org:fulfil_engagements sends a message
      const recruiterAddress = inviteeAddress(
        provider.org.domain,
        "recruiter-1",
      );
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
        {
          contact_id: contactID,
          text: "Following up from our agency team.",
        },
        msgKey,
      );
      expect(sendRes.status(), await sendRes.text()).toBe(200);
      const sentMsg = (await sendRes.json()) as ConversationMessage;
      expect(sentMsg.sender_type).toBe("agency");
      // An Org user has no display name; the email address stands in.
      expect(sentMsg.sender_display_name).toBe(recruiterAddress);
      expect(sentMsg.text).toBe("Following up from our agency team.");

      // 4. Org gets conversation
      const getRes = await provider.api.getConversation(provider.owner, {
        contact_id: contactID,
      });
      expect(getRes.status(), await getRes.text()).toBe(200);
      const convDetail = (await getRes.json()) as ConversationDetail;
      expect(convDetail.messages).toHaveLength(2);
      // Newest first.
      expect(convDetail.messages[0]?.text).toBe(
        "Following up from our agency team.",
      );
      expect(convDetail.messages[1]?.text).toBe(
        "Hello! We came across your profile and would love to chat.",
      );

      // 5. Repeated startConversation with same user opens the existing conversation and sends message
      const reopenKey = orgsIdempotencyKey();
      const reopenRes = await provider.api.startConversation(
        provider.owner,
        {
          address: applicant.alias,
          text: "Starting again directly reopens the existing conversation.",
        },
        reopenKey,
      );
      expect(reopenRes.status(), await reopenRes.text()).toBe(200);
      const reopened = (await reopenRes.json()) as ConversationDetail;
      expect(reopened.conversation.conversation_id).toBe(conversationID);
      expect(reopened.messages).toHaveLength(3);
    } finally {
      cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});

test("Hub user list, get conversation, mark read, reply, and delete", async ({
  request,
}) => {
  await withProvider(request, async (provider) => {
    await published(
      provider.api,
      provider.owner,
      listing("sourcing", "Agency Sourcing"),
    );

    const applicant = seedApplicant(request, "deu");
    const orgDid = orgDID(provider.org.domain, provider.tenant);

    try {
      // Agency starts conversation
      const startRes = await provider.api.startConversation(provider.owner, {
        address: applicant.alias,
        text: "Hi Ada, are you open to new opportunities?",
      });
      expect(startRes.status()).toBe(200);
      const started = (await startRes.json()) as ConversationDetail;
      const contactID = started.conversation.contact_id;

      // 1. Hub user lists conversations
      let list!: ListConversationsResponse;
      await expect
        .poll(
          async () => {
            const listRes = await applicant.hub.listConversations(
              applicant.token,
            );
            if (listRes.status() !== 200) return 0;
            list = (await listRes.json()) as ListConversationsResponse;
            return list.items.length;
          },
          { timeout: 15_000 },
        )
        .toBe(1);
      expect(list.items[0]?.contact_id).toBe(contactID);
      expect(list.items[0]?.agency_domain).toBe(provider.org.domain);
      expect(list.items[0]?.unread_count).toBe(1);

      // 2. Hub user reads conversation live through mesh
      const getRes = await applicant.hub.getConversation(applicant.token, {
        contact_id: contactID,
      });
      expect(getRes.status(), await getRes.text()).toBe(200);
      const hubConv = (await getRes.json()) as HubConversationDetail;
      expect(hubConv.conversation.contact_id).toBe(contactID);
      expect(hubConv.messages).toHaveLength(1);
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
      expect(orgConv.messages).toHaveLength(2);
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
    } finally {
      cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});

test("agencies may message me toggle prevents conversation start, send message, and reply", async ({
  request,
}) => {
  await withProvider(request, async (provider) => {
    await published(
      provider.api,
      provider.owner,
      listing("sourcing", "Agency Sourcing"),
    );

    const applicant = seedApplicant(request, "sgp");
    const orgDid = orgDID(provider.org.domain, provider.tenant);

    try {
      // 1. Applicant turns agencies_may_message OFF
      const setOffRes = await applicant.hub.setAgenciesMayMessage(
        applicant.token,
        {
          agencies_may_message: false,
        },
      );
      expect(setOffRes.status(), await setOffRes.text()).toBe(204);

      // Verify via myInfo
      const infoRes = await applicant.hub.myInfo(applicant.token);
      expect(infoRes.status()).toBe(200);
      expect(
        ((await infoRes.json()) as { agencies_may_message: boolean })
          .agencies_may_message,
      ).toBe(false);

      // 2. Agency tries to start conversation -> rejected with org-agency-messages-off
      const startRes = await provider.api.startConversation(provider.owner, {
        address: applicant.alias,
        text: "Trying to reach you while messages are off",
      });
      await expectProblem(startRes, 403, PROBLEMS.agencyMessagesOff);

      // 3. Applicant turns agencies_may_message back ON
      const setOnRes = await applicant.hub.setAgenciesMayMessage(
        applicant.token,
        {
          agencies_may_message: true,
        },
      );
      expect(setOnRes.status()).toBe(204);

      // 4. Agency starts conversation successfully
      const startOnRes = await provider.api.startConversation(provider.owner, {
        address: applicant.alias,
        text: "Reaching out now that messages are on!",
      });
      expect(startOnRes.status()).toBe(200);
      const conv = (await startOnRes.json()) as ConversationDetail;
      const contactID = conv.conversation.contact_id;

      // 5. Applicant turns messages OFF again; the switch reaches the
      // agency once the Hub tenant knows the agency's pointer.
      await awaitHubPointer(applicant, contactID);
      const setOffAgain = await applicant.hub.setAgenciesMayMessage(
        applicant.token,
        { agencies_may_message: false },
      );
      expect(setOffAgain.status(), await setOffAgain.text()).toBe(204);
      await awaitMessagesOff(provider.api, provider.owner, contactID, true);

      // Agency tries to send message -> rejected with org-agency-messages-off
      const sendRes = await provider.api.sendMessage(provider.owner, {
        contact_id: contactID,
        text: "Another message while off",
      });
      await expectProblem(sendRes, 403, PROBLEMS.agencyMessagesOff);

      // Hub user tries to reply -> rejected with hub-agency-messages-off
      const replyRes = await applicant.hub.replyToConversation(
        applicant.token,
        {
          contact_id: contactID,
          text: "Hub reply while off",
        },
      );
      await expectProblem(replyRes, 403, PROBLEMS.hubAgencyMessagesOff);
    } finally {
      cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});

test("opening suggestion validation: refuses unknown opening or missing sourcing engagement", async ({
  request,
}) => {
  await withProvider(request, async (provider) => {
    await published(
      provider.api,
      provider.owner,
      listing("sourcing", "Agency Sourcing"),
    );

    const applicant = seedApplicant(request, "sgp");
    const orgDid = orgDID(provider.org.domain, provider.tenant);

    try {
      // Suggestion with non-existent consumer domain and opening
      const invalidSuggestionRes = await provider.api.startConversation(
        provider.owner,
        {
          address: applicant.alias,
          suggestion: {
            consumer_domain: "no-engagement.example.test",
            opening_number: 9999,
          },
        },
      );
      await expectProblem(invalidSuggestionRes, 400, PROBLEMS.validation);
    } finally {
      cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});

test("agency daily conversation limit of 50 per UTC day", async ({
  request,
}) => {
  await withProvider(request, async (provider) => {
    await published(
      provider.api,
      provider.owner,
      listing("sourcing", "Agency Sourcing"),
    );

    const applicant = seedApplicant(request, "sgp");
    const orgDid = orgDID(provider.org.domain, provider.tenant);

    try {
      // Artificially set today's conversation creation count to 50
      const today = new Date().toISOString().slice(0, 10);
      sqlScalarForTenant(
        provider.tenant,
        `INSERT INTO vetchium.org_conversation_creations (org_did, created_on, created)
         VALUES ('${orgDid}', '${today}'::date, 50)
         ON CONFLICT (org_did, created_on) DO UPDATE SET created = 50;`,
      );

      const capRes = await provider.api.startConversation(provider.owner, {
        address: applicant.alias,
        text: "Should be blocked by conversation limit",
      });
      await expectProblem(capRes, 429, PROBLEMS.conversationLimit);
    } finally {
      cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});

test("unlisted sourcing listing prevents new conversations", async ({
  request,
}) => {
  await withProvider(request, async (provider) => {
    // Note: No sourcing listing published!
    const applicant = seedApplicant(request, "sgp");
    const orgDid = orgDID(provider.org.domain, provider.tenant);

    try {
      const res = await provider.api.startConversation(provider.owner, {
        address: applicant.alias,
        text: "Should fail because agency is not listed",
      });
      await expectProblem(res, 409, PROBLEMS.listingNotAvailable);
    } finally {
      cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});

test("permissions: org:fulfil_engagements is required", async ({ request }) => {
  await withProvider(request, async (provider) => {
    await published(
      provider.api,
      provider.owner,
      listing("sourcing", "Agency Sourcing"),
    );

    const applicant = seedApplicant(request, "sgp");
    const orgDid = orgDID(provider.org.domain, provider.tenant);

    try {
      // Member without org:fulfil_engagements
      const unprivilegedAddress = inviteeAddress(
        provider.org.domain,
        "unprivileged",
      );
      const unprivileged = await addOrgMember(
        provider.api,
        provider.owner,
        provider.org.domain,
        unprivilegedAddress,
        ["org:view_openings"],
      );

      const startRes = await provider.api.startConversation(
        unprivileged.token,
        {
          address: applicant.alias,
          text: "Should fail permission check",
        },
      );
      await expectProblem(startRes, 403, PROBLEMS.permission);
    } finally {
      cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});

test("counterparty tenant unavailable during Hub conversation get and reply, recovery, and messages switch across tenants", async ({
  request,
}) => {
  await withProvider(
    request,
    async (provider) => {
      await published(
        provider.api,
        provider.owner,
        listing("sourcing", "Agency Sourcing"),
      );

      const applicant = seedApplicant(request, "deu");
      const orgDid = orgDID(provider.org.domain, provider.tenant);

      try {
        // 1. Agency starts conversation with applicant in deu
        const startKey = orgsIdempotencyKey();
        const startRes = await provider.api.startConversation(
          provider.owner,
          {
            address: applicant.alias,
            text: "Hello from agency in sgp!",
          },
          startKey,
        );
        expect(startRes.status(), await startRes.text()).toBe(200);
        const conv = (await startRes.json()) as ConversationDetail;
        const contactID = conv.conversation.contact_id;

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

        // 4. Messages switch reaching existing conversations in other tenants
        // Applicant switches messages off
        const setOff = await applicant.hub.setAgenciesMayMessage(
          applicant.token,
          { agencies_may_message: false },
        );
        expect(setOff.status(), await setOff.text()).toBe(204);
        await awaitMessagesOff(provider.api, provider.owner, contactID, true);

        // Agency sees contact has messages_off: true
        const contactRes = await provider.api.getContact(provider.owner, {
          contact_id: contactID,
        });
        expect(contactRes.status()).toBe(200);
        const contactData = (await contactRes.json()) as Contact;
        expect(contactData.messages_off).toBe(true);

        // Agency cannot send message
        const agencySend = await provider.api.sendMessage(provider.owner, {
          contact_id: contactID,
          text: "Message while off",
        });
        await expectProblem(agencySend, 403, PROBLEMS.agencyMessagesOff);

        // Hub user sees read_only_reason is messages_off and cannot reply
        const hubGet = await applicant.hub.getConversation(applicant.token, {
          contact_id: contactID,
        });
        expect(hubGet.status()).toBe(200);
        const hubConv = (await hubGet.json()) as HubConversationDetail;
        expect(hubConv.conversation.read_only_reason).toBe("messages_off");

        const hubReplyOff = await applicant.hub.replyToConversation(
          applicant.token,
          {
            contact_id: contactID,
            text: "Hub reply while off",
          },
        );
        await expectProblem(hubReplyOff, 403, PROBLEMS.hubAgencyMessagesOff);
      } finally {
        setOrgHome(orgDid, provider.tenant);
        cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
      }
    },
    { tenant: "sgp" },
  );
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

      // The conversation reuses the Contact and reaches the Hub as a newer
      // pointer version.
      const suggestion = {
        consumer_domain: consumer.org.domain,
        opening_number: opening.opening_number,
      };
      const started = await provider.api.startConversation(provider.owner, {
        address: applicant.alias,
        suggestion,
      });
      expect(started.status(), await started.text()).toBe(200);
      expect(
        ((await started.json()) as ConversationDetail).conversation.contact_id,
      ).toBe(contactID);
      await awaitHubPointer(applicant, contactID);
      const suggestedOnly = (items: HubConversationSummary[]) =>
        items[0]?.suggestions.map((item) => [
          item.consumer_domain,
          item.opening_number,
        ]);
      expect(suggestedOnly(await hubList())).toEqual([
        [consumer.org.domain, opening.opening_number],
      ]);

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
        "suggestion",
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
      expect(texts(hubSecond.messages)).toEqual(["suggestion"]);
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
  await withProvider(request, async (provider) => {
    await published(
      provider.api,
      provider.owner,
      listing("sourcing", "Agency Sourcing"),
    );
    // Remote, so a delete crosses the mesh and may be pending.
    const applicant = seedApplicant(request, "deu");
    const orgDid = orgDID(provider.org.domain, provider.tenant);
    try {
      const started = await provider.api.startConversation(provider.owner, {
        address: applicant.alias,
        text: "Hello.",
      });
      expect(started.status(), await started.text()).toBe(200);
      const contact_id = ((await started.json()) as ConversationDetail)
        .conversation.contact_id;
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
    } finally {
      cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});
