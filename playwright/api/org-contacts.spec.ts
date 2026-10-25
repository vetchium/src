import { randomUUID } from "node:crypto";
import type { DeliverEventRequest } from "typespec/federation/events";
import {
  HubAccountAggregate,
  HubAccountDeletedKind,
} from "typespec/federation/marketplace";
import type {
  AddedNote,
  AgencyProfile,
  ContactNote,
  ConversationDetail,
  DeletedNote,
  ListContactNotesResponse,
  ListContactsRequest,
  ListContactsResponse,
} from "typespec/orgs/marketplace/contacts/contacts";
import { expectProblem } from "../lib/admin-api.ts";
import { sqlLiteral, sqlScalarForTenant } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import {
  cleanupApplicant,
  seedApplicant,
  setHubHome,
  verifyProfessionalEmail,
} from "../lib/hub-applicant.ts";
import { meshPeerRequest, meshRelayRequest } from "../lib/mesh.ts";
import {
  addOrgMember,
  inviteeAddress,
  orgAuditEventsByKey,
  orgDID,
  orgSQL,
  orgsIdempotencyKey,
} from "../lib/orgs-api.ts";
import {
  awaitHubPointer,
  awaitMessagesOff,
  listing,
  problems,
  published,
  setOrgHome,
  withProvider,
} from "../lib/orgs-marketplace.ts";

const BASE = "vetchium-problem-details/";

const randomHubUserDID = () =>
  `018f7e32-7b5a-7d31-8fd0-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const PROBLEMS = {
  notFound: `${BASE}org-hub-user-not-found`,
  contactNotFound: `${BASE}org-contact-not-found`,
  noteNotFound: `${BASE}org-contact-note-not-found`,
  notAuthor: `${BASE}org-contact-note-not-author`,
  contactLimit: `${BASE}org-contact-limit-reached`,
  noteLimit: `${BASE}org-contact-note-limit-reached`,
  listingNotAvailable: `${BASE}org-listing-not-available`,
  permission: `${BASE}org-permission-required`,
  validation: `${BASE}validation-failed`,
  tenantUnavailable: `${BASE}org-tenant-unavailable`,
  partyDeleted: `${BASE}org-conversation-party-deleted`,
};

test("agency profile view fields, verified domains, refusals, and mesh remote reads", async ({
  request,
}) => {
  await withProvider(request, async (provider) => {
    // Agency must have a listed sourcing listing
    await published(
      provider.api,
      provider.owner,
      listing("sourcing", "Agency Sourcing"),
    );

    // 1. Remote applicant in deu, agency in sgp
    const applicant = seedApplicant(request, "deu");
    const orgDid = orgDID(provider.org.domain, provider.tenant);

    try {
      const localPart = `ada-${randomUUID()}`;
      await verifyProfessionalEmail(
        applicant,
        `${localPart}@engineering.acme.test`,
        "2024-03-15T12:00:00Z",
        "2025-08-20T18:30:00Z",
      );

      // View by alias
      const viewByAlias = await provider.api.viewHubProfile(provider.owner, {
        address: applicant.alias,
      });
      expect(viewByAlias.status(), await viewByAlias.text()).toBe(200);
      expect(viewByAlias.headers()["cache-control"]).toBe("no-store");
      const profile = (await viewByAlias.json()) as AgencyProfile;

      expect(profile.profile.display_name).toBe("Ada Applicant");
      expect(profile.contact).toBeUndefined();
      expect(profile.verified_domains).toEqual([
        {
          domain: "engineering.acme.test",
          first_verified_month: "2024-03",
          last_verified_month: "2025-08",
        },
      ]);
      // Verify no email address or timestamp leaked
      expect(JSON.stringify(profile)).not.toContain(localPart);
      expect(JSON.stringify(profile)).not.toContain("12:00:00");

      // View by handle
      const viewByHandle = await provider.api.viewHubProfile(provider.owner, {
        address: profile.profile.handle,
      });
      expect(viewByHandle.status(), await viewByHandle.text()).toBe(200);

      // Refusal: unknown address
      const unknown = await provider.api.viewHubProfile(provider.owner, {
        address: "nonexistent-handle-or-alias",
      });
      await expectProblem(unknown, 404, PROBLEMS.notFound);

      // Refusal: user without org:fulfil_engagements
      const unprivileged = inviteeAddress(
        provider.org.domain,
        "no-engagements",
      );
      const unprivilegedMember = await addOrgMember(
        provider.api,
        provider.owner,
        provider.org.domain,
        unprivileged,
        ["org:view_openings"],
      );
      const forbidden = await provider.api.viewHubProfile(
        unprivilegedMember.token,
        {
          address: applicant.alias,
        },
      );
      await expectProblem(forbidden, 403, PROBLEMS.permission);

      // Verify that profile view is never recorded (no contacts created, no audit log)
      const contactCount = sqlScalarForTenant(
        provider.tenant,
        `SELECT count(*)::text FROM vetchium.org_contacts WHERE org_did = '${orgDid}'`,
      );
      expect(contactCount).toBe("0");

      const auditCount = sqlScalarForTenant(
        provider.tenant,
        `SELECT count(*)::text FROM vetchium.audit_events
         WHERE subject_org_did = '${orgDid}' AND action LIKE '%profile_view%'`,
      );
      expect(auditCount).toBe("0");
    } finally {
      cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});

test("notes CRUD, permissions, first-note contact creation, and last-note deletion", async ({
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
      // 1. First note creates the Contact
      const addFirstKey = orgsIdempotencyKey();
      const firstNoteRes = await provider.api.addPersonNote(
        provider.owner,
        {
          address: applicant.alias,
          text: "First contact note: strong distributed systems experience",
        },
        addFirstKey,
      );
      expect(firstNoteRes.status(), await firstNoteRes.text()).toBe(200);
      const added1 = (await firstNoteRes.json()) as AddedNote;
      expect(added1.contact.display_name).toBe("Ada Applicant");
      expect(added1.contact.note_count).toBe(1);
      expect(added1.contact.messages_off).toBe(false);
      expect(added1.note.text).toBe(
        "First contact note: strong distributed systems experience",
      );
      expect(added1.note.mine).toBe(true);

      const contactID = added1.contact.contact_id;
      const noteID1 = added1.note.note_id;

      // Idempotent replay of first note
      const replayRes = await provider.api.addPersonNote(
        provider.owner,
        {
          address: applicant.alias,
          text: "First contact note: strong distributed systems experience",
        },
        addFirstKey,
      );
      expect(replayRes.status()).toBe(200);
      expect(((await replayRes.json()) as AddedNote).note.note_id).toBe(
        noteID1,
      );

      // Audit log has action org.contact.created and org.contact.note_added
      const audits = orgAuditEventsByKey(addFirstKey, provider.tenant);
      expect(audits.map((a) => a.action).sort()).toEqual([
        "org.contact.created",
        "org.contact.note_added",
      ]);

      // Verify agency pointer is enqueued to Hub tenant
      await expect
        .poll(
          async () =>
            sqlScalarForTenant(
              applicant.tenant,
              `SELECT count(*)::text FROM vetchium.hub_agency_pointers
               WHERE contact_id = '${contactID}' AND hub_user_did = '${applicant.did}'`,
            ),
          { timeout: 10_000 },
        )
        .toBe("1");

      // Verify pointer is hidden from Hub API
      const myProfile = await applicant.hub.readProfile(
        { address: applicant.alias },
        applicant.token,
      );
      expect(myProfile.status()).toBe(200);
      const profileText = await myProfile.text();
      expect(profileText).not.toContain(contactID);
      expect(profileText).not.toContain(provider.org.domain);

      // 2. Add second note to existing Contact
      const addSecondKey = orgsIdempotencyKey();
      const secondNoteRes = await provider.api.addContactNote(
        provider.owner,
        {
          contact_id: contactID,
          text: "  Second note with whitespace around  ",
        },
        addSecondKey,
      );
      expect(secondNoteRes.status(), await secondNoteRes.text()).toBe(200);
      const added2 = (await secondNoteRes.json()) as AddedNote;
      expect(added2.contact.note_count).toBe(2);
      expect(added2.note.text).toBe("Second note with whitespace around");
      const noteID2 = added2.note.note_id;

      // 3. Note bounds validation
      const emptyNote = await provider.api.addContactNote(provider.owner, {
        contact_id: contactID,
        text: "   ",
      });
      await expectProblem(emptyNote, 400, PROBLEMS.validation);

      const tooLongNote = await provider.api.addContactNote(provider.owner, {
        contact_id: contactID,
        text: "x".repeat(5001),
      });
      await expectProblem(tooLongNote, 400, PROBLEMS.validation);

      // 4. Author-only edit:
      // Author edits note
      const editKey = orgsIdempotencyKey();
      const editRes = await provider.api.editContactNote(
        provider.owner,
        {
          contact_id: contactID,
          note_id: noteID2,
          text: "Updated text of second note",
        },
        editKey,
      );
      expect(editRes.status(), await editRes.text()).toBe(200);
      const edited = (await editRes.json()) as ContactNote;
      expect(edited.text).toBe("Updated text of second note");
      expect(edited.edited_at).toBeDefined();

      // Another user with org:fulfil_engagements tries to edit: 403
      const colleagueEmail = inviteeAddress(provider.org.domain, "colleague");
      const colleagueMember = await addOrgMember(
        provider.api,
        provider.owner,
        provider.org.domain,
        colleagueEmail,
        ["org:fulfil_engagements"],
      );
      const forbiddenEdit = await provider.api.editContactNote(
        colleagueMember.token,
        {
          contact_id: contactID,
          note_id: noteID2,
          text: "Attempted edit by non-author",
        },
      );
      await expectProblem(forbiddenEdit, 403, PROBLEMS.notAuthor);

      // 5. Any user with permission deletes note:
      // Colleague deletes noteID2
      const deleteKey1 = orgsIdempotencyKey();
      const del1Res = await provider.api.deleteContactNote(
        colleagueMember.token,
        {
          contact_id: contactID,
          note_id: noteID2,
        },
        deleteKey1,
      );
      expect(del1Res.status(), await del1Res.text()).toBe(200);
      const del1 = (await del1Res.json()) as DeletedNote;
      expect(del1.contact_deleted).toBe(false);

      // Verify 1 note remains
      const notesListRes = await provider.api.listContactNotes(provider.owner, {
        contact_id: contactID,
      });
      expect(notesListRes.status()).toBe(200);
      const notesList = (await notesListRes.json()) as ListContactNotesResponse;
      expect(notesList.items).toHaveLength(1);
      expect(notesList.items[0]?.note_id).toBe(noteID1);

      // 6. Delete last note removes Contact and its pointer
      const deleteKey2 = orgsIdempotencyKey();
      const del2Res = await provider.api.deleteContactNote(
        provider.owner,
        {
          contact_id: contactID,
          note_id: noteID1,
        },
        deleteKey2,
      );
      expect(del2Res.status(), await del2Res.text()).toBe(200);
      const del2 = (await del2Res.json()) as DeletedNote;
      expect(del2.contact_deleted).toBe(true);

      // Getting deleted contact returns 404
      const getContactRes = await provider.api.getContact(provider.owner, {
        contact_id: contactID,
      });
      await expectProblem(getContactRes, 404, PROBLEMS.contactNotFound);

      // Pointer on Hub tenant is deleted
      await expect
        .poll(
          async () =>
            sqlScalarForTenant(
              applicant.tenant,
              `SELECT count(*)::text FROM vetchium.hub_agency_pointers
               WHERE contact_id = '${contactID}'`,
            ),
          { timeout: 10_000 },
        )
        .toBe("0");
    } finally {
      cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});

test("caps on daily contact creations and notes per contact", async ({
  request,
}) => {
  await withProvider(request, async (provider) => {
    // 1. Without a listed sourcing listing, creating a Contact is rejected
    const applicant1 = seedApplicant(request, "sgp");
    const orgDid = orgDID(provider.org.domain, provider.tenant);

    try {
      const rejectedNoListing = await provider.api.addPersonNote(
        provider.owner,
        {
          address: applicant1.alias,
          text: "Note without listing",
        },
      );
      await expectProblem(rejectedNoListing, 409, PROBLEMS.listingNotAvailable);

      // Now publish sourcing listing
      await published(
        provider.api,
        provider.owner,
        listing("sourcing", "Agency Sourcing"),
      );

      // Contact creation succeeds
      const created1 = await provider.api.addPersonNote(provider.owner, {
        address: applicant1.alias,
        text: "Note with listing",
      });
      expect(created1.status(), await created1.text()).toBe(200);
      const contactID = ((await created1.json()) as AddedNote).contact
        .contact_id;

      // 2. Simulate reaching daily cap of 200 contacts
      const today = new Date().toISOString().slice(0, 10);
      orgSQL(
        `UPDATE vetchium.org_contact_creations
         SET created = 200
         WHERE org_did = '${orgDid}' AND created_on = '${today}'`,
        provider.tenant,
      );

      const applicant2 = seedApplicant(request, "sgp");
      try {
        const capReached = await provider.api.addPersonNote(provider.owner, {
          address: applicant2.alias,
          text: "Note exceeding daily cap",
        });
        await expectProblem(capReached, 429, PROBLEMS.contactLimit);
      } finally {
        cleanupApplicant(applicant2, [
          { tenant: provider.tenant, did: orgDid },
        ]);
      }

      // 3. Cap of 200 notes per contact
      // Reset created count so we can write notes
      orgSQL(
        `UPDATE vetchium.org_contact_creations
         SET created = 1
         WHERE org_did = '${orgDid}' AND created_on = '${today}'`,
        provider.tenant,
      );

      // 199 more notes reach the cap of 200.
      for (let start = 1; start <= 199; start += 20) {
        const batch = Array.from(
          { length: Math.min(20, 200 - start) },
          (_, index) => start + index,
        );
        for (const response of await Promise.all(
          batch.map((n) =>
            provider.api.addContactNote(provider.owner, {
              contact_id: contactID,
              text: `Bulk note ${n}`,
            }),
          ),
        )) {
          expect(response.status(), await response.text()).toBe(200);
        }
      }

      // 201st note fails with note limit reached
      const noteCapReached = await provider.api.addContactNote(provider.owner, {
        contact_id: contactID,
        text: "Note exceeding 200 per contact",
      });
      await expectProblem(noteCapReached, 409, PROBLEMS.noteLimit);
    } finally {
      cleanupApplicant(applicant1, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});

test("contact retention worker removes contacts inactive for 730 days and prunes creations", async ({
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
      const added = await provider.api.addPersonNote(provider.owner, {
        address: applicant.alias,
        text: "Note to be retained",
      });
      expect(added.status(), await added.text()).toBe(200);
      const contactID = ((await added.json()) as AddedNote).contact.contact_id;

      // Pointer exists on Hub tenant
      await expect
        .poll(
          async () =>
            sqlScalarForTenant(
              applicant.tenant,
              `SELECT count(*)::text FROM vetchium.hub_agency_pointers
               WHERE contact_id = '${contactID}'`,
            ),
          { timeout: 10_000 },
        )
        .toBe("1");

      // Seed an old creation row older than yesterday to test pruning
      orgSQL(
        `INSERT INTO vetchium.org_contact_creations (org_did, created_on, created)
         VALUES ('${orgDid}', (now() AT TIME ZONE 'UTC')::date - 5, 10)
         ON CONFLICT DO NOTHING`,
        provider.tenant,
      );

      // Age the contact past 730 days
      orgSQL(
        `UPDATE vetchium.org_contacts
         SET created_at = now() - interval '800 days',
             last_activity_at = now() - interval '731 days'
         WHERE contact_id = '${contactID}'`,
        provider.tenant,
      );

      // Worker runs every 1s in CI: expect contact to be removed
      await expect
        .poll(
          async () => {
            const res = await provider.api.getContact(provider.owner, {
              contact_id: contactID,
            });
            return res.status();
          },
          { timeout: 15_000 },
        )
        .toBe(404);

      // Pointer on Hub tenant is deleted
      await expect
        .poll(
          async () =>
            sqlScalarForTenant(
              applicant.tenant,
              `SELECT count(*)::text FROM vetchium.hub_agency_pointers
               WHERE contact_id = '${contactID}'`,
            ),
          { timeout: 10_000 },
        )
        .toBe("0");

      // Verify audit event written with reason: retention
      const auditEvent = sqlScalarForTenant(
        provider.tenant,
        `SELECT payload->>'reason' FROM vetchium.audit_events
         WHERE entity_id = '${contactID}' AND action = 'org.contact.deleted'`,
      );
      expect(auditEvent).toBe("retention");

      // Verify old creations pruned
      await expect
        .poll(
          async () =>
            sqlScalarForTenant(
              provider.tenant,
              `SELECT count(*)::text FROM vetchium.org_contact_creations
               WHERE org_did = '${orgDid}' AND created_on < (now() AT TIME ZONE 'UTC')::date - 1`,
            ),
          { timeout: 10_000 },
        )
        .toBe("0");
    } finally {
      cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});

test("the agency-messages switch reaches the agency, and hub-account-deleted removes contacts", async ({
  request,
  apiCoverage,
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
      const added = await provider.api.addPersonNote(provider.owner, {
        address: applicant.alias,
        text: "Note testing notices",
      });
      expect(added.status(), await added.text()).toBe(200);
      const contactID = ((await added.json()) as AddedNote).contact.contact_id;

      // 1. The person's agency-messages switch reaches the agency once the
      // Hub tenant holds the agency's pointer.
      await expect
        .poll(
          () =>
            sqlScalarForTenant(
              applicant.tenant,
              `SELECT count(*)::text FROM vetchium.hub_agency_pointers
               WHERE contact_id = ${sqlLiteral(contactID)}::uuid`,
            ),
          { timeout: 30_000 },
        )
        .toBe("1");
      const switched = await applicant.hub.setAgenciesMayMessage(
        applicant.token,
        { agencies_may_message: false },
      );
      expect(switched.status(), await switched.text()).toBe(204);
      await awaitMessagesOff(provider.api, provider.owner, contactID, true);

      // 2. Test hub-account-deleted via mesh peer delivery
      const accountDeletedEvent: DeliverEventRequest = {
        event_id: randomUUID(),
        kind: HubAccountDeletedKind,
        destination_principal_type: "org",
        destination_principal_did: orgDid,
        aggregate_type: HubAccountAggregate,
        aggregate_id: applicant.did,
        aggregate_version: 1,
        payload: {
          hub_user_did: applicant.did,
        },
      };
      const accountDelivered = meshPeerRequest(
        applicant.tenant,
        provider.tenant,
        accountDeletedEvent,
        apiCoverage,
        { path: "/api/mesh/events/deliver" },
      );
      expect(
        accountDelivered.status,
        JSON.stringify(accountDelivered.body),
      ).toBe(200);
      expect(accountDelivered.body).toEqual({ outcome: "applied" });

      // When applied, all contacts of that person are deleted from the agency
      const deletedRes = await provider.api.getContact(provider.owner, {
        contact_id: contactID,
      });
      expect(deletedRes.status()).toBe(404);
    } finally {
      cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});

test("the Contacts list filters, searches, pages, and counts every tab and unread message", async ({
  request,
}) => {
  await withProvider(request, async (provider) => {
    await published(
      provider.api,
      provider.owner,
      listing("sourcing", "Agency Sourcing"),
    );
    const orgDid = orgDID(provider.org.domain, provider.tenant);
    const ada = seedApplicant(request, "sgp", "Ada Lovelace");
    const grace = seedApplicant(request, "sgp", "Grace Hopper");
    const alan = seedApplicant(request, "sgp", "Alan Turing");
    const list = async (body: ListContactsRequest) => {
      const response = await provider.api.listContacts(provider.owner, body);
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()) as ListContactsResponse;
    };
    const names = (page: ListContactsResponse) =>
      page.items.map((item) => item.display_name);
    try {
      const noted = await provider.api.addPersonNote(provider.owner, {
        address: ada.alias,
        text: "Met at a conference.",
      });
      expect(noted.status(), await noted.text()).toBe(200);
      let graceContact = "";
      for (const person of [alan, grace]) {
        const started = await provider.api.startConversation(provider.owner, {
          address: person.alias,
          text: "Are you open to a new role?",
        });
        expect(started.status(), await started.text()).toBe(200);
        const contactID = ((await started.json()) as ConversationDetail)
          .conversation.contact_id;
        if (person === grace) graceContact = contactID;
      }
      // Each Hub reply adds one to the agency's unread count.
      await awaitHubPointer(grace, graceContact);
      for (const text of ["Yes, tell me more.", "Mornings work best."]) {
        const replied = await grace.hub.replyToConversation(grace.token, {
          contact_id: graceContact,
          text,
        });
        expect(replied.status(), await replied.text()).toBe(200);
      }

      const all = await list({});
      expect(all.counts).toEqual({
        all: 3,
        unread: 1,
        has_conversation: 2,
        not_contacted: 1,
      });
      expect(names(all)).toEqual([
        "Grace Hopper",
        "Alan Turing",
        "Ada Lovelace",
      ]);
      expect(
        all.items.find((item) => item.contact_id === graceContact)
          ?.unread_messages_count,
      ).toBe(2);

      const unread = await list({ filter: "unread" });
      expect(names(unread)).toEqual(["Grace Hopper"]);
      // Counts describe every Contact, whatever the filter.
      expect(unread.counts).toEqual(all.counts);
      expect(names(await list({ filter: "has_conversation" }))).toEqual([
        "Grace Hopper",
        "Alan Turing",
      ]);
      expect(names(await list({ filter: "not_contacted" }))).toEqual([
        "Ada Lovelace",
      ]);
      expect(names(await list({ name_query: "HOP" }))).toEqual([
        "Grace Hopper",
      ]);
      expect(
        names(await list({ filter: "not_contacted", name_query: "hop" })),
      ).toEqual([]);

      const first = await list({ limit: 2 });
      expect(names(first)).toEqual(["Grace Hopper", "Alan Turing"]);
      expect(first.next_pagination_key).toBeDefined();
      const second = await list({
        limit: 2,
        pagination_key: first.next_pagination_key as string,
      });
      expect(names(second)).toEqual(["Ada Lovelace"]);
      expect(second.next_pagination_key).toBeUndefined();

      // Reading the conversation clears its unread count for the agency.
      const read = await provider.api.markConversationRead(provider.owner, {
        contact_id: graceContact,
      });
      expect(read.status(), await read.text()).toBeLessThan(300);
      const after = await list({});
      expect(after.counts.unread).toBe(0);
      expect(
        after.items.find((item) => item.contact_id === graceContact)
          ?.unread_messages_count,
      ).toBe(0);

      for (const [body, field] of [
        [{ name_query: "a" }, "name_query"],
        [{ filter: "archived" }, "filter"],
      ] as const) {
        await expectProblem(
          await provider.api.listContacts(
            provider.owner,
            body as ListContactsRequest,
          ),
          400,
          PROBLEMS.validation,
          [field],
        );
      }
    } finally {
      for (const person of [ada, grace, alan]) {
        cleanupApplicant(person, [{ tenant: provider.tenant, did: orgDid }]);
      }
    }
  });
});

test("a deleted Hub account leaves a Contact with a conversation read-only and its notes gone", async ({
  request,
  apiCoverage,
}) => {
  await withProvider(request, async (provider) => {
    await published(
      provider.api,
      provider.owner,
      listing("sourcing", "Agency Sourcing"),
    );
    const applicant = seedApplicant(request, "deu", "Ada Lovelace");
    const orgDid = orgDID(provider.org.domain, provider.tenant);
    try {
      const started = await provider.api.startConversation(provider.owner, {
        address: applicant.alias,
        text: "Hello from the agency.",
      });
      expect(started.status(), await started.text()).toBe(200);
      const contactID = ((await started.json()) as ConversationDetail)
        .conversation.contact_id;
      const noted = await provider.api.addContactNote(provider.owner, {
        contact_id: contactID,
        text: "Strong candidate.",
      });
      expect(noted.status(), await noted.text()).toBe(200);

      // Account deletion is not built, so its notice is delivered directly.
      const delivered = meshPeerRequest(
        applicant.tenant,
        provider.tenant,
        {
          event_id: randomUUID(),
          kind: HubAccountDeletedKind,
          destination_principal_type: "org",
          destination_principal_did: orgDid,
          aggregate_type: HubAccountAggregate,
          aggregate_id: applicant.did,
          aggregate_version: 1,
          payload: { hub_user_did: applicant.did },
        } satisfies DeliverEventRequest,
        apiCoverage,
        { path: "/api/mesh/events/deliver" },
      );
      expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);

      const contact = await provider.api.getContact(provider.owner, {
        contact_id: contactID,
      });
      expect(contact.status(), await contact.text()).toBe(200);
      expect(await contact.json()).toMatchObject({
        account_deleted: true,
        note_count: 0,
        has_conversation: true,
      });
      const notes = await provider.api.listContactNotes(provider.owner, {
        contact_id: contactID,
      });
      expect(((await notes.json()) as ListContactNotesResponse).items).toEqual(
        [],
      );
      const conversation = await provider.api.getConversation(provider.owner, {
        contact_id: contactID,
      });
      expect(
        ((await conversation.json()) as ConversationDetail).conversation
          .read_only_reason,
      ).toBe("hub_user_deleted");
      await expectProblem(
        await provider.api.addContactNote(provider.owner, {
          contact_id: contactID,
          text: "Another note.",
        }),
        409,
        PROBLEMS.partyDeleted,
      );
      await expectProblem(
        await provider.api.sendMessage(provider.owner, {
          contact_id: contactID,
          text: "Are you still there?",
        }),
        409,
        PROBLEMS.partyDeleted,
      );
    } finally {
      cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});

test("Contact and conversation routes authenticate, authorize, validate, and refuse suspended Orgs", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withProvider(request, async (provider) => {
    await published(
      provider.api,
      provider.owner,
      listing("sourcing", "Agency Sourcing"),
    );
    const orgDid = orgDID(provider.org.domain, provider.tenant);
    const applicant = seedApplicant(request, "sgp");
    const away = seedApplicant(request, "sgp");
    const viewer = await addOrgMember(
      provider.api,
      provider.owner,
      provider.org.domain,
      inviteeAddress(provider.org.domain, "viewer"),
      ["org:view_openings"],
    );
    const colleague = await addOrgMember(
      provider.api,
      provider.owner,
      provider.org.domain,
      inviteeAddress(provider.org.domain, "colleague"),
      ["org:fulfil_engagements"],
    );
    try {
      const started = await provider.api.startConversation(provider.owner, {
        address: applicant.alias,
        text: "Hello.",
      });
      expect(started.status(), await started.text()).toBe(200);
      const contact_id = ((await started.json()) as ConversationDetail)
        .conversation.contact_id;
      const noted = await provider.api.addContactNote(provider.owner, {
        contact_id,
        text: "A note.",
      });
      expect(noted.status(), await noted.text()).toBe(200);
      const note_id = ((await noted.json()) as AddedNote).note.note_id;

      const routes: Array<{ path: string; body: object; write: boolean }> = [
        {
          path: "/view-hub-profile",
          body: { address: applicant.alias },
          write: false,
        },
        { path: "/list-contacts", body: {}, write: false },
        { path: "/get-contact", body: { contact_id }, write: false },
        { path: "/list-contact-notes", body: { contact_id }, write: false },
        { path: "/get-conversation", body: { contact_id }, write: false },
        { path: "/mark-conversation-read", body: { contact_id }, write: false },
        { path: "/list-credited-applications", body: {}, write: false },
        {
          path: "/add-person-note",
          body: { address: applicant.alias, text: "Note" },
          write: true,
        },
        {
          path: "/add-contact-note",
          body: { contact_id, text: "Note" },
          write: true,
        },
        {
          path: "/edit-contact-note",
          body: { contact_id, note_id, text: "Edited" },
          write: true,
        },
        {
          path: "/delete-contact-note",
          body: { contact_id, note_id },
          write: true,
        },
        {
          path: "/start-conversation",
          body: { address: applicant.alias, text: "Hi" },
          write: true,
        },
        {
          path: "/send-message",
          body: { contact_id, text: "Hi" },
          write: true,
        },
      ];
      const keyed = (write: boolean) =>
        write ? { idempotencyKey: orgsIdempotencyKey() } : {};
      for (const entry of routes) {
        await expectProblem(
          await provider.api.post(entry.path, entry.body, keyed(entry.write)),
          401,
          problems.authentication,
        );
        await expectProblem(
          await provider.api.postRaw(entry.path, "{", {
            token: provider.owner,
            ...keyed(entry.write),
          }),
          400,
          problems.invalidJSON,
        );
        await expectProblem(
          await provider.api.post(entry.path, entry.body, {
            token: viewer.token,
            ...keyed(entry.write),
          }),
          403,
          problems.permission,
        );
        if (entry.write) {
          expect(
            (
              await provider.api.post(entry.path, entry.body, {
                token: provider.owner,
              })
            ).status(),
            `${entry.path} needs an Idempotency-Key`,
          ).toBe(400);
        }
      }

      const unknown = randomUUID();
      const invalid: Array<[string, object, string[]]> = [
        ["/view-hub-profile", { address: "" }, ["address"]],
        ["/list-contacts", { limit: 0 }, ["limit"]],
        ["/get-contact", { contact_id: "x" }, ["contact_id"]],
        ["/list-contact-notes", { contact_id: "x" }, ["contact_id"]],
        ["/get-conversation", { contact_id: "x" }, ["contact_id"]],
        ["/mark-conversation-read", { contact_id: "x" }, ["contact_id"]],
        ["/list-credited-applications", { limit: 0 }, ["limit"]],
        ["/add-person-note", { address: "x", text: " " }, ["address", "text"]],
        ["/add-contact-note", { contact_id, text: " " }, ["text"]],
        [
          "/edit-contact-note",
          { contact_id, note_id: "x", text: "ok" },
          ["note_id"],
        ],
        ["/delete-contact-note", { contact_id, note_id: "x" }, ["note_id"]],
        ["/start-conversation", { address: applicant.alias }, ["text"]],
        ["/send-message", { contact_id: "x", text: "Hi" }, ["contact_id"]],
      ];
      for (const [path, body, fields] of invalid) {
        const write = routes.find((entry) => entry.path === path)?.write;
        await expectProblem(
          await provider.api.post(path, body, {
            token: provider.owner,
            ...keyed(write === true),
          }),
          400,
          PROBLEMS.validation,
          fields,
        );
      }
      for (const [path, body] of [
        ["/list-contacts", {}],
        ["/list-contact-notes", { contact_id }],
      ] as const) {
        await expectProblem(
          await provider.api.post(
            path,
            { ...body, pagination_key: "bm90LWEta2V5" },
            { token: provider.owner },
          ),
          400,
          `${BASE}invalid-pagination-key`,
        );
      }

      // An unknown Contact, note, or person is not found.
      for (const entry of routes.filter(
        (route) => "contact_id" in route.body,
      )) {
        await expectProblem(
          await provider.api.post(
            entry.path,
            { ...entry.body, contact_id: unknown },
            { token: provider.owner, ...keyed(entry.write) },
          ),
          404,
          PROBLEMS.contactNotFound,
        );
      }
      for (const path of ["/edit-contact-note", "/delete-contact-note"]) {
        const body = routes.find((entry) => entry.path === path)?.body;
        await expectProblem(
          await provider.api.post(
            path,
            { ...body, note_id: unknown },
            { token: provider.owner, idempotencyKey: orgsIdempotencyKey() },
          ),
          404,
          PROBLEMS.noteNotFound,
        );
      }
      for (const entry of routes.filter((route) => "address" in route.body)) {
        await expectProblem(
          await provider.api.post(
            entry.path,
            { ...entry.body, address: "e2e-00000000000000000000" },
            { token: provider.owner, ...keyed(entry.write) },
          ),
          404,
          PROBLEMS.notFound,
        );
      }

      // Only its author edits or deletes a note.
      for (const path of ["/edit-contact-note", "/delete-contact-note"]) {
        const body = routes.find((entry) => entry.path === path)?.body;
        await expectProblem(
          await provider.api.post(path, body, {
            token: colleague.token,
            idempotencyKey: orgsIdempotencyKey(),
          }),
          403,
          PROBLEMS.notAuthor,
        );
      }

      // A key stays bound to the request it first carried. The note is
      // deleted last, as the other writes still name it.
      const writes = routes.filter((route) => route.write);
      writes.sort(
        (a, b) =>
          Number(a.path === "/delete-contact-note") -
          Number(b.path === "/delete-contact-note"),
      );
      for (const entry of writes) {
        const key = orgsIdempotencyKey();
        const first = await provider.api.post(entry.path, entry.body, {
          token: provider.owner,
          idempotencyKey: key,
        });
        expect(first.status(), `${entry.path}: ${await first.text()}`).toBe(
          200,
        );
        const changed =
          "text" in entry.body
            ? { ...entry.body, text: "Something else" }
            : { ...entry.body, note_id: unknown };
        await expectProblem(
          await provider.api.post(entry.path, changed, {
            token: provider.owner,
            idempotencyKey: key,
          }),
          409,
          problems.keyConflict,
        );
      }

      // A person whose tenant does not answer cannot be read or reached.
      setHubHome(away.did, "gone");
      try {
        for (const entry of routes.filter((route) => "address" in route.body)) {
          await expectProblem(
            await provider.api.post(
              entry.path,
              { ...entry.body, address: away.alias },
              { token: provider.owner, ...keyed(entry.write) },
            ),
            503,
            PROBLEMS.tenantUnavailable,
          );
        }
      } finally {
        setHubHome(away.did, away.tenant);
      }

      orgSQL(
        `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
         WHERE org_did = '${orgDid}'`,
        provider.tenant,
      );
      for (const entry of routes) {
        await expectProblem(
          await provider.api.post(entry.path, entry.body, {
            token: provider.owner,
            ...keyed(entry.write),
          }),
          403,
          problems.suspended,
        );
      }
    } finally {
      for (const person of [applicant, away]) {
        cleanupApplicant(person, [{ tenant: provider.tenant, did: orgDid }]);
      }
    }
  });
});

test("the mesh reads behind Contacts and conversations answer only the tenant that homes their party", async ({
  request,
  apiCoverage,
}) => {
  await withProvider(request, async (provider) => {
    await published(
      provider.api,
      provider.owner,
      listing("sourcing", "Agency Sourcing"),
    );
    const applicant = seedApplicant(request, "deu");
    const orgDid = orgDID(provider.org.domain, provider.tenant);
    const expectType = (
      response: { status: number; body: unknown },
      status: number,
      type: string,
    ) => {
      expect(response.status, JSON.stringify(response.body)).toBe(status);
      expect(response.body).toMatchObject({ type, status });
    };
    try {
      const started = await provider.api.startConversation(provider.owner, {
        address: applicant.alias,
        text: "Hello from the agency.",
      });
      expect(started.status(), await started.text()).toBe(200);
      const contact_id = ((await started.json()) as ConversationDetail)
        .conversation.contact_id;

      // The agency's tenant reads the profile from the Hub user's.
      const profileRelay = "/mesh/agency-profile/read";
      const relayProfile = { agency_org_did: orgDid, address: applicant.alias };
      const read = meshRelayRequest(
        provider.tenant,
        profileRelay,
        relayProfile,
        apiCoverage,
      );
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      expect(read.body).toMatchObject({
        hub_user_did: applicant.did,
        agencies_may_message: true,
      });
      expectType(
        meshRelayRequest(
          provider.tenant,
          profileRelay,
          relayProfile,
          apiCoverage,
          {
            authorization: null,
          },
        ),
        401,
        `${BASE}mesh-relay-authentication-required`,
      );
      expectType(
        meshRelayRequest(
          provider.tenant,
          profileRelay,
          undefined,
          apiCoverage,
          {
            rawBody: "{",
          },
        ),
        400,
        `${BASE}invalid-json`,
      );
      expectType(
        meshRelayRequest(
          provider.tenant,
          profileRelay,
          { agency_org_did: "x", address: "" },
          apiCoverage,
        ),
        400,
        PROBLEMS.validation,
      );
      expectType(
        meshRelayRequest(
          provider.tenant,
          profileRelay,
          { ...relayProfile, address: "e2e-00000000000000000000" },
          apiCoverage,
        ),
        404,
        PROBLEMS.notFound,
      );
      setHubHome(applicant.did, "gone");
      try {
        expectType(
          meshRelayRequest(
            provider.tenant,
            profileRelay,
            relayProfile,
            apiCoverage,
          ),
          503,
          PROBLEMS.tenantUnavailable,
        );
      } finally {
        setHubHome(applicant.did, applicant.tenant);
      }

      const profilePeer = { path: "/api/mesh/agency-profile/read" };
      const peerProfile = {
        agency_org_did: orgDid,
        target_hub_user_did: applicant.did,
      };
      const peer = meshPeerRequest(
        provider.tenant,
        applicant.tenant,
        peerProfile,
        apiCoverage,
        profilePeer,
      );
      expect(peer.status, JSON.stringify(peer.body)).toBe(200);
      expect(peer.body).toMatchObject({ hub_user_did: applicant.did });
      expect(
        meshPeerRequest(
          provider.tenant,
          applicant.tenant,
          peerProfile,
          apiCoverage,
          { ...profilePeer, certificate: "health" },
        ).status,
      ).toBe(401);
      expectType(
        meshPeerRequest(
          provider.tenant,
          applicant.tenant,
          { agency_org_did: orgDid, target_hub_user_did: "x" },
          apiCoverage,
          profilePeer,
        ),
        400,
        PROBLEMS.validation,
      );
      expectType(
        meshPeerRequest(
          provider.tenant,
          applicant.tenant,
          { ...peerProfile, target_hub_user_did: randomHubUserDID() },
          apiCoverage,
          profilePeer,
        ),
        404,
        PROBLEMS.notFound,
      );

      // The Hub user's tenant reads the conversation from the agency's.
      const conversationRelay = "/mesh/conversations/read";
      const conversation = {
        contact_id,
        hub_user_did: applicant.did,
        agency_org_did: orgDid,
      };
      const live = meshRelayRequest(
        applicant.tenant,
        conversationRelay,
        conversation,
        apiCoverage,
      );
      expect(live.status, JSON.stringify(live.body)).toBe(200);
      expect(
        (live.body as { messages: Array<{ text?: string }> }).messages.map(
          (message) => message.text,
        ),
      ).toEqual(["Hello from the agency."]);
      expectType(
        meshRelayRequest(
          applicant.tenant,
          conversationRelay,
          conversation,
          apiCoverage,
          { authorization: null },
        ),
        401,
        `${BASE}mesh-relay-authentication-required`,
      );
      expectType(
        meshRelayRequest(
          applicant.tenant,
          conversationRelay,
          { ...conversation, contact_id: "x" },
          apiCoverage,
        ),
        400,
        PROBLEMS.validation,
      );
      expectType(
        meshRelayRequest(
          applicant.tenant,
          conversationRelay,
          { ...conversation, pagination_key: "bm90LWEta2V5" },
          apiCoverage,
        ),
        400,
        `${BASE}invalid-pagination-key`,
      );
      expectType(
        meshRelayRequest(
          applicant.tenant,
          conversationRelay,
          { ...conversation, contact_id: randomUUID() },
          apiCoverage,
        ),
        404,
        `${BASE}org-conversation-not-found`,
      );
      setOrgHome(orgDid, "gone");
      try {
        expectType(
          meshRelayRequest(
            applicant.tenant,
            conversationRelay,
            conversation,
            apiCoverage,
          ),
          503,
          PROBLEMS.tenantUnavailable,
        );
      } finally {
        setOrgHome(orgDid, provider.tenant);
      }

      const conversationPeer = { path: "/api/mesh/conversations/read" };
      const fromHome = meshPeerRequest(
        applicant.tenant,
        provider.tenant,
        conversation,
        apiCoverage,
        conversationPeer,
      );
      expect(fromHome.status, JSON.stringify(fromHome.body)).toBe(200);
      // A tenant that does not home the Hub user learns nothing.
      expectType(
        meshPeerRequest(
          "usa1",
          provider.tenant,
          conversation,
          apiCoverage,
          conversationPeer,
        ),
        404,
        `${BASE}org-conversation-not-found`,
      );
      expect(
        meshPeerRequest(
          applicant.tenant,
          provider.tenant,
          conversation,
          apiCoverage,
          { ...conversationPeer, certificate: "health" },
        ).status,
      ).toBe(401);
      expectType(
        meshPeerRequest(
          applicant.tenant,
          provider.tenant,
          { ...conversation, hub_user_did: "x" },
          apiCoverage,
          conversationPeer,
        ),
        400,
        PROBLEMS.validation,
      );
    } finally {
      cleanupApplicant(applicant, [{ tenant: provider.tenant, did: orgDid }]);
    }
  });
});
