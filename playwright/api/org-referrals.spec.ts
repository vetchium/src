import type { ListConversationsResponse } from "typespec/hub/messages/messages";
import type { ListApplicationsResponse } from "typespec/orgs/applications/applications";
import type { ListCreditedApplicationsResponse } from "typespec/orgs/marketplace/attribution";
import type {
  Contact,
  ConversationDetail,
} from "typespec/orgs/marketplace/contacts/contacts";
import type {
  JobDetail,
  ListJobsResponse,
} from "typespec/orgs/marketplace/work/work";
import { expectProblem } from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { hubIdempotencyKey } from "../lib/hub-api.ts";
import {
  apply,
  cleanupApplicant,
  seedApplicant,
} from "../lib/hub-applicant.ts";
import { meshPeerRequest, meshRelayRequest } from "../lib/mesh.ts";
import { orgDID, orgsIdempotencyKey } from "../lib/orgs-api.ts";
import { detailOf, shortlist } from "../lib/orgs-applications.ts";
import { activate, asProvider } from "../lib/orgs-marketplace.ts";
import { assign, routed, withWorld } from "../lib/orgs-routing.ts";

const BASE = "vetchium-problem-details/";
const PROBLEMS = {
  agencyNotEligible: `${BASE}hub-referral-agency-not-eligible`,
  validation: `${BASE}validation-failed`,
  meshPeerAuth: `${BASE}mesh-peer-authentication-required`,
  meshRelayAuth: `${BASE}mesh-relay-authentication-required`,
};

test("sourcing attribution: declared and suggested credit, eligibility, agency reads, and mesh operations", async ({
  request,
  apiCoverage,
}) => {
  test.setTimeout(240_000);
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer, provider } = pair;

    // 1. Setup active sourcing engagement assigned whole to the published opening
    const sourcing = await activate(pair, "sourcing");
    await asProvider(pair, sourcing.id, sourcing.version);
    await assign(world, sourcing.id);

    const providerDID = orgDID(provider.org.domain, provider.tenant);

    // 2. Seed applicants
    // Applicant 1: tests declared referral
    const applicant1 = seedApplicant(request, consumer.tenant);
    // Applicant 2: tests suggestion in conversation then suggested referral
    const applicant2 = seedApplicant(request, consumer.tenant);
    // Applicant 3: tests direct application (no referral)
    const applicant3 = seedApplicant(request, consumer.tenant);

    try {
      // 3. Ineligible referral check (MKT-SRC-003, MKT-TST-001)
      // 3a. Applicant attempts to name an agency with no assigned sourcing engagement
      const ineligibleRes = await applicant1.hub.applyToOpening(
        {
          domain: consumer.org.domain,
          opening_number: opening.opening_number,
          referral_agency_domain: "ineligible-agency.example.test",
        },
        { token: applicant1.token, idempotencyKey: hubIdempotencyKey() },
      );
      await expectProblem(ineligibleRes, 422, PROBLEMS.agencyNotEligible);

      // 3b. Remote agency in another tenant not assigned to the opening
      const remoteIneligibleRes = await applicant1.hub.applyToOpening(
        {
          domain: consumer.org.domain,
          opening_number: opening.opening_number,
          referral_agency_domain: "remote-unassigned.usa1.example.test",
        },
        { token: applicant1.token, idempotencyKey: hubIdempotencyKey() },
      );
      await expectProblem(remoteIneligibleRes, 422, PROBLEMS.agencyNotEligible);

      // 3c. Non-primary domain of the assigned agency
      const nonPrimaryRes = await applicant1.hub.applyToOpening(
        {
          domain: consumer.org.domain,
          opening_number: opening.opening_number,
          referral_agency_domain: `alias.${provider.org.domain}`,
        },
        { token: applicant1.token, idempotencyKey: hubIdempotencyKey() },
      );
      await expectProblem(nonPrimaryRes, 422, PROBLEMS.agencyNotEligible);

      // Applicant 1 applies again, choosing declared referral to provider agency
      const ref1 = await apply(
        applicant1,
        consumer.org.domain,
        opening.opening_number,
        provider.org.domain,
      );
      expect(ref1.application_number).toBe(1);

      // Verify consumer reads application 1: route is "declared"
      const app1 = await detailOf(
        consumer.api,
        consumer.owner,
        opening.opening_number,
        ref1.application_number,
      );
      expect(app1.referral_route).toBe("declared");
      expect(app1.credited_agency).toMatchObject({
        engagement_id: sourcing.id,
        domain: provider.org.domain,
      });

      // 4. Suggested referral (MKT-SRC-004, MKT-DAT-008)
      // Agency starts conversation with applicant 2 and sends an Opening suggestion
      const startKey = orgsIdempotencyKey();
      const startRes = await provider.api.startConversation(
        provider.owner,
        {
          address: applicant2.handle,
          suggestion: {
            consumer_domain: consumer.org.domain,
            opening_number: opening.opening_number,
          },
        },
        startKey,
      );
      expect(startRes.status(), await startRes.text()).toBe(200);
      const conversation = (await startRes.json()) as ConversationDetail;
      const contactID = conversation.conversation.contact_id;
      expect(contactID).toBeTruthy();

      // The suggestion reaches applicant 2 with the agency's pointer.
      await expect
        .poll(
          async () => {
            const listed = await applicant2.hub.listConversations(
              applicant2.token,
            );
            if (listed.status() !== 200) return [];
            return ((await listed.json()) as ListConversationsResponse).items
              .filter((item) => item.contact_id === contactID)
              .flatMap((item) => item.suggestions)
              .map((suggestion) => [
                suggestion.consumer_domain,
                suggestion.opening_number,
              ]);
          },
          { timeout: 30_000 },
        )
        .toEqual([[consumer.org.domain, opening.opening_number]]);

      // Applicant 2 applies naming the agency that suggested the opening
      const ref2 = await apply(
        applicant2,
        consumer.org.domain,
        opening.opening_number,
        provider.org.domain,
      );
      expect(ref2.application_number).toBe(2);

      // Verify consumer reads application 2: route is "suggested"
      const app2 = await detailOf(
        consumer.api,
        consumer.owner,
        opening.opening_number,
        ref2.application_number,
      );
      expect(app2.referral_route).toBe("suggested");
      expect(app2.credited_agency).toMatchObject({
        engagement_id: sourcing.id,
        domain: provider.org.domain,
      });

      // 5. Direct application (MKT-SRC-005)
      // Applicant 3 applies directly without naming any agency
      const ref3 = await apply(
        applicant3,
        consumer.org.domain,
        opening.opening_number,
      );
      expect(ref3.application_number).toBe(3);
      const app3 = await detailOf(
        consumer.api,
        consumer.owner,
        opening.opening_number,
        ref3.application_number,
      );
      expect(app3.referral_route).toBeUndefined();
      expect(app3.credited_agency).toBeUndefined();

      // 6. Consumer application listing and filters (MKT-SRC-007)
      const listAll = (await (
        await consumer.api.listApplications(consumer.owner, {
          opening_number: opening.opening_number,
          view: "applicants",
        })
      ).json()) as ListApplicationsResponse;
      expect(listAll.applications).toHaveLength(3);

      const listDeclared = (await (
        await consumer.api.listApplications(consumer.owner, {
          opening_number: opening.opening_number,
          view: "applicants",
          referral_route: "declared",
        })
      ).json()) as ListApplicationsResponse;
      expect(listDeclared.applications).toHaveLength(1);
      expect(listDeclared.applications[0]?.application_number).toBe(1);

      const listSuggested = (await (
        await consumer.api.listApplications(consumer.owner, {
          opening_number: opening.opening_number,
          view: "applicants",
          referral_route: "suggested",
        })
      ).json()) as ListApplicationsResponse;
      expect(listSuggested.applications).toHaveLength(1);
      expect(listSuggested.applications[0]?.application_number).toBe(2);

      const listByAgency = (await (
        await consumer.api.listApplications(consumer.owner, {
          opening_number: opening.opening_number,
          view: "applicants",
          credited_agency_domain: provider.org.domain,
        })
      ).json()) as ListApplicationsResponse;
      expect(listByAgency.applications).toHaveLength(2);

      // 7. Agency reads: Credited applications list (MKT-SRC-006)
      const creditedRes = await provider.api.listCreditedApplications(
        provider.owner,
        {},
      );
      expect(creditedRes.status(), await creditedRes.text()).toBe(200);
      expect(creditedRes.headers()["cache-control"]).toBe("no-store");
      const creditedData =
        (await creditedRes.json()) as ListCreditedApplicationsResponse;
      expect(creditedData.items).toHaveLength(2);

      // App 3 (direct application) is not credited and does NOT appear
      expect(creditedData.items.some((i) => i.application_number === 3)).toBe(
        false,
      );

      // Contact ID is attached for the contact we have in our database (applicant 2)
      const creditedItem2 = creditedData.items.find(
        (i) => i.application_number === 2,
      );
      expect(creditedItem2).toBeDefined();
      expect(creditedItem2?.route).toBe("suggested");
      expect(creditedItem2?.status).toBe("applied");
      expect(creditedItem2?.contact_id).toBe(contactID);

      const creditedItem1 = creditedData.items.find(
        (i) => i.application_number === 1,
      );
      expect(creditedItem1).toBeDefined();
      expect(creditedItem1?.route).toBe("declared");
      expect(creditedItem1?.status).toBe("applied");

      // Filter credited applications by route
      const creditedSuggestedOnly = (await (
        await provider.api.listCreditedApplications(provider.owner, {
          route: "suggested",
        })
      ).json()) as ListCreditedApplicationsResponse;
      expect(creditedSuggestedOnly.items).toHaveLength(1);
      expect(creditedSuggestedOnly.items[0]?.application_number).toBe(2);

      // Filter credited applications by contact_id
      const creditedContactOnly = (await (
        await provider.api.listCreditedApplications(provider.owner, {
          contact_id: contactID,
        })
      ).json()) as ListCreditedApplicationsResponse;
      expect(creditedContactOnly.items).toHaveLength(1);
      expect(creditedContactOnly.items[0]?.application_number).toBe(2);

      // 7b. Agency also engaged for a stage on the same Opening sees no credit on routed candidacies (MKT-ACC-002, MKT-TST-001)
      const interviewing = await activate(pair, "interviewing");
      await asProvider(pair, interviewing.id, interviewing.version);
      await assign(world, interviewing.id, world.panel);

      const shortlistedApp3 = await shortlist(
        consumer.api,
        consumer.owner,
        opening.opening_number,
        ref3.application_number,
        world.panel,
      );
      await routed(world, shortlistedApp3, interviewing.id);

      // Provider reads credited applications again: App 3 was routed to it for the panel stage,
      // but it was a direct application, so the agency sees NO credit for it
      const afterRouteCredited = (await (
        await provider.api.listCreditedApplications(provider.owner, {})
      ).json()) as ListCreditedApplicationsResponse;
      expect(
        afterRouteCredited.items.some((i) => i.application_number === 3),
      ).toBe(false);

      // 8. Agency reads: Job detail and Job list with credited count and suggestions
      const jobRes = await provider.api.getJob(provider.owner, {
        engagement_id: sourcing.id,
        opening_number: opening.opening_number,
      });
      expect(jobRes.status(), await jobRes.text()).toBe(200);
      const job = (await jobRes.json()) as JobDetail;
      expect(job.job.credited_count).toBe(2);
      expect(job.credited_applications).toHaveLength(2);
      expect(job.suggested_contacts).toHaveLength(1);
      expect(job.suggested_contacts[0]?.contact_id).toBe(contactID);

      const jobsListRes = await provider.api.listJobs(provider.owner, {});
      expect(jobsListRes.status()).toBe(200);
      const jobsList = (await jobsListRes.json()) as ListJobsResponse;
      const jobEntry = jobsList.jobs.find(
        (j) => j.opening.number === opening.opening_number,
      );
      expect(jobEntry).toBeDefined();
      expect(jobEntry?.credited_count).toBe(2);

      // 9. Agency reads: Contact detail with credited count and suggested openings
      const contactRes = await provider.api.getContact(provider.owner, {
        contact_id: contactID,
      });
      expect(contactRes.status()).toBe(200);
      const contactData = (await contactRes.json()) as Contact;
      expect(contactData.credited_count).toBe(1);
      expect(contactData.suggested_openings).toHaveLength(1);
      expect(contactData.suggested_openings[0]?.consumer_domain).toBe(
        consumer.org.domain,
      );
      expect(contactData.suggested_openings[0]?.opening_number).toBe(
        opening.opening_number,
      );

      // 10. Mesh relay and peer contract verification (MKT-TST-001)
      const relayRes = meshRelayRequest(
        consumer.tenant,
        "/mesh/provider-attribution/list",
        {
          tenant: consumer.tenant,
          request: {
            provider_org_did: providerDID,
            limit: 10,
          },
        },
        apiCoverage,
      );
      expect(relayRes.status, JSON.stringify(relayRes.body)).toBe(200);
      expect((relayRes.body as { items: unknown[] }).items).toHaveLength(2);

      // Peer endpoint with valid mTLS certificate
      const peerRes = meshPeerRequest(
        provider.tenant,
        consumer.tenant,
        {
          provider_org_did: providerDID,
          limit: 10,
        },
        apiCoverage,
        { path: "/api/mesh/provider-attribution/list" },
      );
      expect(peerRes.status, JSON.stringify(peerRes.body)).toBe(200);
      expect((peerRes.body as { items: unknown[] }).items).toHaveLength(2);

      // Peer endpoint without mTLS certificate fails authentication
      const peerUnauth = meshPeerRequest(
        provider.tenant,
        consumer.tenant,
        {
          provider_org_did: providerDID,
          limit: 10,
        },
        apiCoverage,
        {
          path: "/api/mesh/provider-attribution/list",
          certificate: "health",
        },
      );
      expect(peerUnauth.status).toBe(401);

      // Relay endpoint without authorization
      const relayUnauth = meshRelayRequest(
        consumer.tenant,
        "/mesh/provider-attribution/list",
        {
          tenant: consumer.tenant,
          request: {
            provider_org_did: providerDID,
            limit: 10,
          },
        },
        apiCoverage,
        { authorization: null },
      );
      expect(relayUnauth.status).toBe(401);
    } finally {
      const consumerRef = {
        tenant: consumer.tenant,
        did: orgDID(consumer.org.domain, consumer.tenant),
      };
      cleanupApplicant(applicant1, [consumerRef]);
      cleanupApplicant(applicant2, [consumerRef]);
      cleanupApplicant(applicant3, [consumerRef]);
    }
  });
});
