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
  DeletedNote,
  ListContactNotesResponse,
} from "typespec/orgs/marketplace/contacts/contacts";
import { expectProblem } from "../lib/admin-api.ts";
import { sqlLiteral, sqlScalarForTenant } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import {
  cleanupApplicant,
  seedApplicant,
  verifyProfessionalEmail,
} from "../lib/hub-applicant.ts";
import { meshPeerRequest } from "../lib/mesh.ts";
import {
  addOrgMember,
  inviteeAddress,
  orgAuditEventsByKey,
  orgDID,
  orgSQL,
  orgsIdempotencyKey,
} from "../lib/orgs-api.ts";
import {
  awaitMessagesOff,
  listing,
  published,
  withProvider,
} from "../lib/orgs-marketplace.ts";

const BASE = "vetchium-problem-details/";
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
