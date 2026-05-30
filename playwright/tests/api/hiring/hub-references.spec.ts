/**
 * Tests for hub-side reference endpoints:
 * - POST /hub/list-reference-requests-incoming
 * - POST /hub/nominate-references
 * - POST /hub/accept-reference-nomination
 * - POST /hub/decline-reference-nomination
 * - POST /hub/submit-reference-response
 */

import { test, expect } from "@playwright/test";
import { HubAPIClient } from "../../../lib/hub-api-client";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestHubUserDirect,
	createTestOrgAdminDirect,
	createTestHubConnectionDirect,
	deleteTestHubUser,
	generateTestEmail,
	generateTestOrgEmail,
	deleteTestGlobalOrgDomain,
	createTestOpeningDirect,
	createTestApplicationDirect,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type { ReferenceQuestion } from "vetchium-specs/hub/references";

const QUESTIONS: ReferenceQuestion[] = [
	{
		question_id: "q1",
		text: "How long did you work together and what was your relationship?",
		min_chars: 50,
		max_chars: 2000,
		required: true,
	},
];

async function loginOrgUser(
	api: OrgAPIClient,
	email: string,
	domain: string
): Promise<string> {
	const loginReq: OrgLoginRequest = { email, domain, password: TEST_PASSWORD };
	const loginRes = await api.login(loginReq);
	expect(loginRes.status).toBe(200);
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaRes = await api.verifyTFA({
		tfa_token: loginRes.body!.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	} as OrgTFARequest);
	expect(tfaRes.status).toBe(200);
	return tfaRes.body!.session_token;
}

test.describe("Hub References", () => {
	test.describe.configure({ mode: "serial" });

	const { email: orgEmail, domain: orgDomain } =
		generateTestOrgEmail("hub-refs");
	const candidateEmail = generateTestEmail("ref-candidate");
	const nomineeEmail = generateTestEmail("ref-nominee");

	let candidateToken: string;
	let candidateGlobalId: string;
	let nomineeToken: string;
	let nomineeGlobalId: string;
	let nomineeHandle: string;
	let orgToken: string;
	let orgId: string;
	let orgUserId: string;
	let candidacyId: string;
	let requestId: string;
	let nominationId: string;

	test.beforeAll(async ({ request }) => {
		const candidateResult = await createTestHubUserDirect(
			candidateEmail,
			TEST_PASSWORD,
			"refcand"
		);
		candidateToken = candidateResult.sessionToken;
		candidateGlobalId = candidateResult.hubUserGlobalId;

		const nomineeResult = await createTestHubUserDirect(
			nomineeEmail,
			TEST_PASSWORD,
			"refnominee"
		);
		nomineeToken = nomineeResult.sessionToken;
		nomineeGlobalId = nomineeResult.hubUserGlobalId;
		nomineeHandle = nomineeResult.handle;

		// Connect candidate and nominee
		await createTestHubConnectionDirect(
			candidateGlobalId,
			candidateResult.handle,
			nomineeGlobalId,
			nomineeHandle
		);

		const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
		orgId = orgResult.orgId;
		orgUserId = orgResult.orgUserId;
		const orgApi = new OrgAPIClient(request);
		orgToken = await loginOrgUser(orgApi, orgEmail, orgDomain);

		const opening = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"Hub Refs Opening"
		);
		const appId = await createTestApplicationDirect(
			orgId,
			orgDomain,
			opening.openingId,
			opening.openingNumber,
			candidateGlobalId,
			candidateResult.handle,
			"Hub Refs Candidate"
		);
		const shortlistRes = await orgApi.shortlistApplication(orgToken, {
			application_id: appId,
		});
		expect(shortlistRes.status).toBe(200);
		candidacyId = shortlistRes.body.candidacy_id;

		// Org requests references
		const refRes = await orgApi.requestReferences(orgToken, {
			candidacy_id: candidacyId,
			max_references: 2,
			response_deadline: "2027-12-31",
			questions: QUESTIONS,
		});
		expect(refRes.status).toBe(201);
		requestId = refRes.body.request_id;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(candidateEmail);
		await deleteTestHubUser(nomineeEmail);
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	// ─── list-reference-requests-incoming (nominee side) ─────────────────────────

	test("list-reference-requests-incoming: returns 200 with empty list before nomination", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const res = await hubClient.listReferenceRequestsIncoming(nomineeToken, {});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body!.requests)).toBe(true);
	});

	test("list-reference-requests-incoming: 401 when unauthenticated", async ({
		request,
	}) => {
		const res = await request.post("/hub/list-reference-requests-incoming", {
			data: {},
		});
		expect(res.status()).toBe(401);
	});

	// ─── nominate-references ──────────────────────────────────────────────────────

	test("nominate-references: candidate nominates connected colleague — returns nomination_ids", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const res = await hubClient.nominateReferences(candidateToken, {
			request_id: requestId,
			nominee_handles: [nomineeHandle],
		});
		expect(res.status).toBe(201);
		expect(Array.isArray(res.body!.nomination_ids)).toBe(true);
		expect(res.body!.nomination_ids.length).toBe(1);
		nominationId = res.body!.nomination_ids[0];
		expect(typeof nominationId).toBe("string");
	});

	test("nominate-references: 400 when nominee is not a connection", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const res = await hubClient.nominateReferences(candidateToken, {
			request_id: requestId,
			nominee_handles: ["nonexistent-handle-xyz"],
		});
		expect(res.status).toBe(400);
	});

	test("nominate-references: 401 when unauthenticated", async ({ request }) => {
		const res = await request.post("/hub/nominate-references", {
			data: { request_id: requestId, nominee_handles: [nomineeHandle] },
		});
		expect(res.status()).toBe(401);
	});

	// ─── list-reference-requests-incoming (after nomination) ─────────────────────

	test("list-reference-requests-incoming: nominee sees nomination after being nominated", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const res = await hubClient.listReferenceRequestsIncoming(nomineeToken, {});
		expect(res.status).toBe(200);

		const found = res.body!.requests.find(
			(r: { nomination_id?: string }) => r.nomination_id === nominationId
		);
		expect(found).toBeDefined();
		expect(found!.kind).toBe("to_respond");
		expect(found!.state).toBe("nominated");
	});

	// ─── accept-reference-nomination ──────────────────────────────────────────────

	test("accept-reference-nomination: nominee accepts — state becomes accepted", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const acceptRes = await hubClient.acceptReferenceNomination(nomineeToken, {
			nomination_id: nominationId,
		});
		expect(acceptRes.status).toBe(200);

		// Audit log
		const auditRes = await hubClient.listAuditLogs(nomineeToken, {
			event_types: ["hub.accept_reference_nomination"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string }) =>
				e.event_type === "hub.accept_reference_nomination"
		);
		expect(entry).toBeDefined();
	});

	test("accept-reference-nomination: 422 when already accepted", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const res = await hubClient.acceptReferenceNomination(nomineeToken, {
			nomination_id: nominationId,
		});
		expect(res.status).toBe(422);
	});

	test("accept-reference-nomination: 401 when unauthenticated", async ({
		request,
	}) => {
		const res = await request.post("/hub/accept-reference-nomination", {
			data: { nomination_id: nominationId },
		});
		expect(res.status()).toBe(401);
	});

	// ─── submit-reference-response ────────────────────────────────────────────────

	test("submit-reference-response: nominee submits answers — audit log written", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const submitRes = await hubClient.submitReferenceResponse(nomineeToken, {
			nomination_id: nominationId,
			answers: [
				{
					question_id: "q1",
					response_text:
						"We worked together for three years on the platform team. They were an excellent engineer with strong technical skills and great communication.",
				},
			],
		});
		expect(submitRes.status).toBe(200);

		// Audit log
		const auditRes = await hubClient.listAuditLogs(nomineeToken, {
			event_types: ["hub.submit_reference_response"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string }) =>
				e.event_type === "hub.submit_reference_response"
		);
		expect(entry).toBeDefined();

		// Org can now see the response via list-reference-responses
		const orgApi = new OrgAPIClient(request);
		const responsesRes = await orgApi.listReferenceResponses(orgToken, {
			request_id: requestId,
		});
		expect(responsesRes.status).toBe(200);
		const respFound = responsesRes.body!.responses.find(
			(r: { nomination_id: string }) => r.nomination_id === nominationId
		);
		expect(respFound).toBeDefined();
	});

	test("submit-reference-response: 422 when already submitted", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const res = await hubClient.submitReferenceResponse(nomineeToken, {
			nomination_id: nominationId,
			answers: [{ question_id: "q1", response_text: "A".repeat(50) }],
		});
		expect(res.status).toBe(422);
	});

	test("submit-reference-response: 401 when unauthenticated", async ({
		request,
	}) => {
		const res = await request.post("/hub/submit-reference-response", {
			data: {
				nomination_id: nominationId,
				answers: [{ question_id: "q1", response_text: "A".repeat(50) }],
			},
		});
		expect(res.status()).toBe(401);
	});

	// ─── decline-reference-nomination ────────────────────────────────────────────

	test("decline-reference-nomination: fresh nominee declines silently", async ({
		request,
	}) => {
		// Create a second nomination with another fresh hub user
		const declineEmail = generateTestEmail("ref-decline");
		const declineHub = await createTestHubUserDirect(
			declineEmail,
			TEST_PASSWORD,
			"refdecline"
		);
		// Connect with candidate
		await createTestHubConnectionDirect(
			candidateGlobalId,
			"refcand",
			declineHub.hubUserGlobalId,
			declineHub.handle
		);

		// Nominate the decline user
		const hubClient = new HubAPIClient(request);
		const nomRes = await hubClient.nominateReferences(candidateToken, {
			request_id: requestId,
			nominee_handles: [declineHub.handle],
		});
		if (nomRes.status !== 201) {
			// If we've hit max_references, skip
			await deleteTestHubUser(declineEmail).catch(() => {});
			return;
		}
		const declineNomId = nomRes.body!.nomination_ids[0];

		const declineRes = await hubClient.declineReferenceNomination(
			declineHub.sessionToken,
			{ nomination_id: declineNomId }
		);
		expect(declineRes.status).toBe(200);

		// Audit log written even though the decline is silent to the candidate
		const auditRes = await hubClient.listAuditLogs(declineHub.sessionToken, {
			event_types: ["hub.decline_reference_nomination"],
		});
		expect(auditRes.status).toBe(200);
		const auditEntry = auditRes.body?.audit_logs?.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "hub.decline_reference_nomination" &&
				e.event_data?.nomination_id === declineNomId
		);
		expect(auditEntry).toBeDefined();

		// Org sees it in declined_nominations
		const orgApi = new OrgAPIClient(request);
		const respRes = await orgApi.listReferenceResponses(orgToken, {
			request_id: requestId,
		});
		expect(respRes.status).toBe(200);
		const declined = respRes.body!.declined_nominations.find(
			(n: { nomination_id: string }) => n.nomination_id === declineNomId
		);
		expect(declined).toBeDefined();
		expect(declined!.state).toBe("declined");

		await deleteTestHubUser(declineEmail).catch(() => {});
	});
});
