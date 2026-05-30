import { test, expect } from "@playwright/test";
import { HubAPIClient } from "../../../lib/hub-api-client";
import {
	createTestHubUserDirect,
	createTestOrgAdminDirect,
	deleteTestHubUser,
	generateTestEmail,
	generateTestOrgEmail,
	deleteTestGlobalOrgDomain,
	createTestWorkEmailStintDirect,
	createTestHubConnectionDirect,
	createTestOpeningDirect,
	createTestApplicationDirect,
	createTestEndorsementRequestDirect,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	RequestEndorsementsRequest,
	WriteEndorsementRequest,
	UpdateEndorsementRequest,
	DeclineEndorsementRequestRequest,
	HideEndorsementOnApplicationRequest,
	ShowEndorsementOnApplicationRequest,
	ListEndorsementRequestsIncomingRequest,
	ListEndorsementRequestsOutgoingRequest,
} from "vetchium-specs/hub/endorsements";

test.describe("T3 Endorsements", () => {
	test.describe.configure({ mode: "serial" });

	const candidateEmail = generateTestEmail("endorse-candidate");
	const endorserEmail = generateTestEmail("endorse-endorser");
	const { email: orgEmail, domain: orgDomain } =
		generateTestOrgEmail("endorse-org");

	let candidateToken: string;
	let endorserToken: string;
	let candidateGlobalId: string;
	let candidateHandle: string;
	let endorserGlobalId: string;
	let endorserHandle: string;
	let orgId: string;
	let orgUserId: string;
	let applicationId: string;
	let requestId: string;
	let endorsementId: string;

	test.beforeAll(async () => {
		const sharedDomain = "shared-employer.example.com";

		const candidateResult = await createTestHubUserDirect(
			candidateEmail,
			TEST_PASSWORD,
			"endorse-cand"
		);
		candidateToken = candidateResult.sessionToken;
		candidateGlobalId = candidateResult.hubUserGlobalId;
		candidateHandle = candidateResult.handle;

		const endorserResult = await createTestHubUserDirect(
			endorserEmail,
			TEST_PASSWORD,
			"endorse-end"
		);
		endorserToken = endorserResult.sessionToken;
		endorserGlobalId = endorserResult.hubUserGlobalId;
		endorserHandle = endorserResult.handle;

		// Create verified work stints at same domain for both users (required for endorsement)
		await createTestWorkEmailStintDirect(
			candidateGlobalId,
			`${candidateHandle}@${sharedDomain}`,
			"active"
		);
		await createTestWorkEmailStintDirect(
			endorserGlobalId,
			`${endorserHandle}@${sharedDomain}`,
			"active"
		);

		// Connect the two hub users
		await createTestHubConnectionDirect(
			candidateGlobalId,
			candidateHandle,
			endorserGlobalId,
			endorserHandle
		);

		// Create org and opening
		const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
		orgId = orgResult.orgId;
		orgUserId = orgResult.orgUserId;

		const openingResult = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"Senior Engineer"
		);

		// Create application
		applicationId = await createTestApplicationDirect(
			orgId,
			orgDomain,
			openingResult.openingId,
			openingResult.openingNumber,
			candidateGlobalId,
			candidateHandle,
			"Test Candidate"
		);

		// Create an endorsement request from candidate to endorser
		requestId = await createTestEndorsementRequestDirect(
			applicationId,
			endorserGlobalId
		);
	});

	test.afterAll(async () => {
		await deleteTestHubUser(candidateEmail);
		await deleteTestHubUser(endorserEmail);
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	// ─── List endorsement requests (incoming = endorser side) ───────────────

	test("list-endorsement-requests-incoming returns 200 for endorser", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const req: ListEndorsementRequestsIncomingRequest = {};
		const res = await api.listEndorsementRequestsIncoming(endorserToken, req);
		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty("requests");
		const found = res.body!.requests.find((r) => r.request_id === requestId);
		expect(found).toBeDefined();
	});

	test("list-endorsement-requests-incoming returns 401 unauthenticated", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const res = await api.listEndorsementRequestsIncoming("bad-token", {});
		expect(res.status).toBe(401);
	});

	// ─── List endorsement requests (outgoing = candidate side) ──────────────

	test("list-endorsement-requests-outgoing returns 200 for candidate", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const req: ListEndorsementRequestsOutgoingRequest = {
			application_id: applicationId,
		};
		const res = await api.listEndorsementRequestsOutgoing(candidateToken, req);
		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty("requests");
	});

	test("list-endorsement-requests-outgoing returns 401 unauthenticated", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const res = await api.listEndorsementRequestsOutgoing("bad-token", {
			application_id: applicationId,
		});
		expect(res.status).toBe(401);
	});

	// ─── Request endorsements ────────────────────────────────────────────────

	test("request-endorsements 400 for non-connection handle", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const req: RequestEndorsementsRequest = {
			application_id: applicationId,
			endorser_handles: ["nonexistent-handle"],
		};
		const res = await api.requestEndorsements(candidateToken, req);
		expect(res.status).toBe(400);
	});

	test("request-endorsements 401 unauthenticated", async ({ request }) => {
		const api = new HubAPIClient(request);
		const req: RequestEndorsementsRequest = {
			application_id: applicationId,
			endorser_handles: [endorserHandle],
		};
		const res = await api.requestEndorsements("bad-token", req);
		expect(res.status).toBe(401);
	});

	// ─── Write endorsement ───────────────────────────────────────────────────

	test("write-endorsement 400 for text < 100 chars", async ({ request }) => {
		const api = new HubAPIClient(request);
		const req: WriteEndorsementRequest = {
			request_id: requestId,
			text: "Too short.",
		};
		const res = await api.writeEndorsement(endorserToken, req);
		expect(res.status).toBe(400);
	});

	test("write-endorsement 400 for text > 2000 chars", async ({ request }) => {
		const api = new HubAPIClient(request);
		const req: WriteEndorsementRequest = {
			request_id: requestId,
			text: "A".repeat(2001),
		};
		const res = await api.writeEndorsement(endorserToken, req);
		expect(res.status).toBe(400);
	});

	test("write-endorsement 201 happy path — exactly 100 chars", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const req: WriteEndorsementRequest = {
			request_id: requestId,
			text: "A".repeat(100),
		};
		const res = await api.writeEndorsement(endorserToken, req);
		expect(res.status).toBe(201);
		expect(res.body).toHaveProperty("endorsement_id");
		endorsementId = res.body!.endorsement_id;

		// Audit log assertion
		const auditRes = await api.listAuditLogs(endorserToken, {
			event_types: ["hub.write_endorsement"],
		});
		expect(auditRes.status).toBe(200);
		const auditEntry = auditRes.body?.audit_logs?.find(
			(e: { event_type: string }) => e.event_type === "hub.write_endorsement"
		);
		expect(auditEntry).toBeDefined();
	});

	test("write-endorsement 401 unauthenticated", async ({ request }) => {
		const api = new HubAPIClient(request);
		const req: WriteEndorsementRequest = {
			request_id: requestId,
			text: "A".repeat(100),
		};
		const res = await api.writeEndorsement("bad-token", req);
		expect(res.status).toBe(401);
	});

	// ─── Decline endorsement request (separate request needed) ──────────────

	test("decline-endorsement-request 401 unauthenticated", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const req: DeclineEndorsementRequestRequest = {
			request_id: requestId,
		};
		const res = await api.declineEndorsementRequest("bad-token", req);
		expect(res.status).toBe(401);
	});

	// ─── Update endorsement ──────────────────────────────────────────────────

	test("update-endorsement 401 unauthenticated", async ({ request }) => {
		const api = new HubAPIClient(request);
		const req: UpdateEndorsementRequest = {
			endorsement_id: endorsementId,
			text: "A".repeat(100),
		};
		const res = await api.updateEndorsement("bad-token", req);
		expect(res.status).toBe(401);
	});

	// ─── Hide / show endorsement on application ──────────────────────────────

	test("hide-endorsement-on-application 401 unauthenticated", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const req: HideEndorsementOnApplicationRequest = {
			endorsement_id: endorsementId,
		};
		const res = await api.hideEndorsementOnApplication("bad-token", req);
		expect(res.status).toBe(401);
	});

	test("show-endorsement-on-application 401 unauthenticated", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const req: ShowEndorsementOnApplicationRequest = {
			endorsement_id: endorsementId,
		};
		const res = await api.showEndorsementOnApplication("bad-token", req);
		expect(res.status).toBe(401);
	});

	test("hide-endorsement-on-application 404 when endorsement does not belong to caller's application", async ({
		request,
	}) => {
		// The endorser tries to hide an endorsement on the candidate's application
		// — the endorser is not the candidate so they get 404
		const api = new HubAPIClient(request);
		const req: HideEndorsementOnApplicationRequest = {
			endorsement_id: endorsementId,
		};
		const res = await api.hideEndorsementOnApplication(endorserToken, req);
		expect(res.status).toBe(404);
	});

	test("hide-endorsement-on-application 200 + audit when the candidate hides their own endorsement", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const req: HideEndorsementOnApplicationRequest = {
			endorsement_id: endorsementId,
		};
		const res = await api.hideEndorsementOnApplication(candidateToken, req);
		expect(res.status).toBe(200);

		const auditRes = await api.listAuditLogs(candidateToken, {
			event_types: ["hub.hide_endorsement"],
		});
		expect(auditRes.status).toBe(200);
		const entry = auditRes.body?.audit_logs?.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "hub.hide_endorsement" &&
				e.event_data?.endorsement_id === endorsementId
		);
		expect(entry).toBeDefined();
	});

	test("show-endorsement-on-application 200 + audit when the candidate re-shows their endorsement", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const req: ShowEndorsementOnApplicationRequest = {
			endorsement_id: endorsementId,
		};
		const res = await api.showEndorsementOnApplication(candidateToken, req);
		expect(res.status).toBe(200);

		const auditRes = await api.listAuditLogs(candidateToken, {
			event_types: ["hub.show_endorsement"],
		});
		expect(auditRes.status).toBe(200);
		const entry = auditRes.body?.audit_logs?.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "hub.show_endorsement" &&
				e.event_data?.endorsement_id === endorsementId
		);
		expect(entry).toBeDefined();
	});

	test("decline-endorsement-request 200 + audit; declining silently records an audit entry", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);

		// A fresh opening + application + pending request (the original request
		// was already resolved by the write-endorsement happy path). The candidate
		// already has a live application in the primary org, and
		// applications_one_live_per_org forbids a second live application for the
		// same candidate in the same org — so use a separate org here.
		const { email: declineOrgEmail, domain: declineOrgDomain } =
			generateTestOrgEmail("endorse-decline-org");
		const declineOrg = await createTestOrgAdminDirect(
			declineOrgEmail,
			TEST_PASSWORD
		);
		try {
			const opening2 = await createTestOpeningDirect(
				declineOrg.orgId,
				declineOrg.orgUserId,
				"Decline Flow Opening"
			);
			const application2 = await createTestApplicationDirect(
				declineOrg.orgId,
				declineOrgDomain,
				opening2.openingId,
				opening2.openingNumber,
				candidateGlobalId,
				candidateHandle,
				"Test Candidate"
			);
			const request2 = await createTestEndorsementRequestDirect(
				application2,
				endorserGlobalId
			);

			const res = await api.declineEndorsementRequest(endorserToken, {
				request_id: request2,
			});
			expect(res.status).toBe(200);

			const auditRes = await api.listAuditLogs(endorserToken, {
				event_types: ["hub.decline_endorsement_request"],
			});
			expect(auditRes.status).toBe(200);
			const entry = auditRes.body?.audit_logs?.find(
				(e: { event_type: string; event_data: Record<string, unknown> }) =>
					e.event_type === "hub.decline_endorsement_request" &&
					e.event_data?.request_id === request2
			);
			expect(entry).toBeDefined();
		} finally {
			await deleteTestGlobalOrgDomain(declineOrgDomain).catch(() => {});
		}
	});
});
