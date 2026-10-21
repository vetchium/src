import { randomUUID } from "node:crypto";
import {
  AgencyContactMessagesAggregate,
  HubAgencyMessagesChangedKind,
} from "typespec/federation/marketplace";
import type {
  HubConversationDetail,
  ListConversationsResponse,
} from "typespec/hub/messages/messages";
import type {
  ConversationDetail,
  ConversationMessage,
} from "typespec/orgs/marketplace/contacts/contacts";
import { expectProblem } from "../lib/admin-api.ts";
import { sqlScalarForTenant } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { cleanupApplicant, seedApplicant } from "../lib/hub-applicant.ts";
import { meshPeerRequest } from "../lib/mesh.ts";
import {
  addOrgMember,
  inviteeAddress,
  orgAuditEventsByKey,
  orgDID,
  orgsIdempotencyKey,
} from "../lib/orgs-api.ts";
import { listing, published, withProvider } from "../lib/orgs-marketplace.ts";

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

  hubConversationNotFound: `${BASE}hub-conversation-not-found`,
  hubAgencyMessagesOff: `${BASE}hub-agency-messages-off`,
  hubPartyDeleted: `${BASE}hub-conversation-party-deleted`,
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
        "org.conversation.message-sent",
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
      expect(sentMsg.sender_display_name).toBe("recruiter-1");
      expect(sentMsg.text).toBe("Following up from our agency team.");

      // 4. Org gets conversation
      const getRes = await provider.api.getConversation(provider.owner, {
        contact_id: contactID,
      });
      expect(getRes.status(), await getRes.text()).toBe(200);
      const convDetail = (await getRes.json()) as ConversationDetail;
      expect(convDetail.messages).toHaveLength(2);
      expect(convDetail.messages[0]?.text).toBe(
        "Hello! We came across your profile and would love to chat.",
      );
      expect(convDetail.messages[1]?.text).toBe(
        "Following up from our agency team.",
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
      const listRes = await applicant.hub.listConversations(applicant.token);
      expect(listRes.status(), await listRes.text()).toBe(200);
      const list = (await listRes.json()) as ListConversationsResponse;
      expect(list.items).toHaveLength(1);
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
      expect(orgConv.messages[1]?.text).toBe(
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
      const listAfterDelete = await applicant.hub.listConversations(
        applicant.token,
      );
      expect(
        ((await listAfterDelete.json()) as ListConversationsResponse).items,
      ).toHaveLength(0);

      // Contact still remains on Org side (MKT-CON-004), but conversation is gone
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
    } finally {
      cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});

test("agencies may message me toggle prevents conversation start, send message, and reply", async ({
  request,
  apiCoverage,
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
      expect(setOffRes.status(), await setOffRes.text()).toBe(200);

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
      await expectProblem(startRes, 422, PROBLEMS.agencyMessagesOff);

      // 3. Applicant turns agencies_may_message back ON
      const setOnRes = await applicant.hub.setAgenciesMayMessage(
        applicant.token,
        {
          agencies_may_message: true,
        },
      );
      expect(setOnRes.status()).toBe(200);

      // 4. Agency starts conversation successfully
      const startOnRes = await provider.api.startConversation(provider.owner, {
        address: applicant.alias,
        text: "Reaching out now that messages are on!",
      });
      expect(startOnRes.status()).toBe(200);
      const conv = (await startOnRes.json()) as ConversationDetail;
      const contactID = conv.conversation.contact_id;

      // 5. Applicant turns messages OFF again
      await applicant.hub.setAgenciesMayMessage(applicant.token, {
        agencies_may_message: false,
      });

      // Deliver federation event to agency tenant to simulate async delivery
      const messagesEvent = {
        event_id: randomUUID(),
        aggregate_type: AgencyContactMessagesAggregate,
        aggregate_id: contactID,
        aggregate_version: 1,
        kind: HubAgencyMessagesChangedKind,
        authority: { type: "hub_user", did: applicant.did },
        occurred_at: new Date().toISOString(),
        payload: {
          contact_id: contactID,
          hub_user_did: applicant.did,
          messages_off: true,
        },
      };
      meshPeerRequest(
        applicant.tenant,
        provider.tenant,
        messagesEvent,
        apiCoverage,
        { path: "/api/mesh/events/deliver" },
      );

      // Agency tries to send message -> rejected with org-agency-messages-off
      const sendRes = await provider.api.sendMessage(provider.owner, {
        contact_id: contactID,
        text: "Another message while off",
      });
      await expectProblem(sendRes, 422, PROBLEMS.agencyMessagesOff);

      // Hub user tries to reply -> rejected with hub-agency-messages-off
      const replyRes = await applicant.hub.replyToConversation(
        applicant.token,
        {
          contact_id: contactID,
          text: "Hub reply while off",
        },
      );
      await expectProblem(replyRes, 422, PROBLEMS.hubAgencyMessagesOff);
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
      await expectProblem(invalidSuggestionRes, 422, PROBLEMS.validation);
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
        `INSERT INTO vetchium.org_conversation_creations (org_did, day, created_count)
         VALUES ('${orgDid}', '${today}'::date, 50)
         ON CONFLICT (org_did, day) DO UPDATE SET created_count = 50;`,
      );

      const capRes = await provider.api.startConversation(provider.owner, {
        address: applicant.alias,
        text: "Should be blocked by conversation limit",
      });
      await expectProblem(capRes, 422, PROBLEMS.conversationLimit);
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
      await expectProblem(res, 422, PROBLEMS.listingNotAvailable);
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
