/**
 * Full hiring lifecycle: Apply → Shortlist → Schedule Interview →
 * RSVP → Submit Feedback → Extend Offer → Request References
 *
 * Also covers extend-offer multipart upload, state transitions, and audit logs.
 */

import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	createTestHubUserDirect,
	assignRoleToOrgUser,
	generateTestOrgEmail,
	generateTestEmail,
	generateOrgUserEmail,
	deleteTestGlobalOrgDomain,
	deleteTestHubUser,
	createTestOpeningDirect,
	createTestApplicationDirect,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";

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

// Minimal valid PDF bytes (magic bytes + minimal structure)
const MINIMAL_PDF = Buffer.from(
	"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
		"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
		"3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\n" +
		"xref\n0 4\n0000000000 65535 f\n" +
		"trailer<</Size 4/Root 1 0 R>>\nstartxref\n%%EOF\n"
);

const FUTURE_START = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
	.toISOString()
	.replace(/\.\d+Z$/, "Z");
const FUTURE_END = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000 + 3600000)
	.toISOString()
	.replace(/\.\d+Z$/, "Z");

test.describe("Full Hiring Lifecycle", () => {
	test.describe.configure({ mode: "serial" });

	const { email: adminEmail, domain: orgDomain } =
		generateTestOrgEmail("lifecycle-admin");
	const interviewerEmail = generateOrgUserEmail("lifecycle-ivr", orgDomain);
	const hubEmail = generateTestEmail("lifecycle-hub");

	let adminToken: string;
	let interviewerToken: string;
	let orgId: string;
	let adminUserId: string;
	let interviewerUserId: string;
	let hubUserGlobalId: string;
	let hubHandle: string;
	let applicationId: string;
	let candidacyId: string;
	let interviewId: string;

	test.beforeAll(async ({ request }) => {
		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		orgId = adminResult.orgId;
		adminUserId = adminResult.orgUserId;
		const orgApi = new OrgAPIClient(request);
		adminToken = await loginOrgUser(orgApi, adminEmail, orgDomain);

		const ivResult = await createTestOrgUserDirect(
			interviewerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain: orgDomain }
		);
		interviewerUserId = ivResult.orgUserId;
		interviewerToken = await loginOrgUser(orgApi, interviewerEmail, orgDomain);

		const hubResult = await createTestHubUserDirect(
			hubEmail,
			TEST_PASSWORD,
			"lifecycle-hub"
		);
		hubUserGlobalId = hubResult.hubUserGlobalId;
		hubHandle = hubResult.handle;

		const openingResult = await createTestOpeningDirect(
			orgId,
			adminUserId,
			"Lifecycle Test Opening"
		);
		applicationId = await createTestApplicationDirect(
			orgId,
			orgDomain,
			openingResult.openingId,
			openingResult.openingNumber,
			hubUserGlobalId,
			hubHandle,
			"Lifecycle Test Candidate"
		);
	});

	test.afterAll(async () => {
		await deleteTestHubUser(hubEmail);
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	// ─── Step 1: Shortlist → Candidacy ──────────────────────────────────────────

	test("Step 1 — Shortlist creates candidacy in interviewing state", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.shortlistApplication(adminToken, {
			application_id: applicationId,
		});
		expect(res.status).toBe(200);
		expect(res.body.state).toBe("interviewing");
		candidacyId = res.body.candidacy_id;
		expect(candidacyId).toBeTruthy();
	});

	// ─── Step 2: Schedule Interview ─────────────────────────────────────────────

	test("Step 2 — Schedule interview on the candidacy", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: FUTURE_START,
			ends_at: FUTURE_END,
			interviewer_email_addresses: [interviewerEmail],
		});
		expect(res.status).toBe(201);
		expect(res.body).toHaveProperty("interview_id");
		interviewId = res.body.interview_id;

		// Interview appears in list
		const listRes = await api.listInterviews(adminToken, {
			filter_candidacy_id: candidacyId,
		});
		expect(listRes.status).toBe(200);
		const found = listRes.body!.interviews.find(
			(iv: { interview_id: string }) => iv.interview_id === interviewId
		);
		expect(found).toBeDefined();
		expect(found!.state).toBe("scheduled");
		expect(found!.interviewer_count).toBe(1);

		// Candidacy detail shows the interview
		const candRes = await api.getCandidacy(adminToken, {
			candidacy_id: candidacyId,
		});
		expect(candRes.status).toBe(200);
		expect(candRes.body.state).toBe("interviewing");
	});

	// ─── Step 3: Interviewer RSVP ───────────────────────────────────────────────

	test("Step 3 — Interviewer RSVPs yes", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.rsvpInterview(interviewerToken, {
			interview_id: interviewId,
			rsvp: "yes",
		});
		expect(res.status).toBe(200);

		// RSVP reflected in list
		const listRes = await api.listInterviews(adminToken, {
			filter_candidacy_id: candidacyId,
		});
		const found = listRes.body!.interviews.find(
			(iv: { interview_id: string }) => iv.interview_id === interviewId
		);
		expect(found!.candidate_rsvp).toBeUndefined(); // candidate RSVP is hub-side
	});

	// ─── Step 4: Submit Feedback → Interview completed ──────────────────────────

	test("Step 4 — Interviewer submits feedback, interview transitions to completed", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.submitInterviewFeedback(interviewerToken, {
			interview_id: interviewId,
			decision: "strong_yes",
			positives: "Exceptional problem-solving ability and clear communication.",
			negatives:
				"Needs to improve knowledge of distributed consensus algorithms.",
			overall_assessment:
				"Strong candidate. Highly recommend proceeding to offer stage.",
			candidate_feedback:
				"Great performance on the system design question. Minor gaps on consensus.",
		});
		expect(res.status).toBe(200);

		// Interview is now completed
		const ivRes = await api.getInterview(adminToken, {
			interview_id: interviewId,
		});
		expect(ivRes.status).toBe(200);
		expect(ivRes.body.state).toBe("completed");

		// Candidacy still in interviewing (offer not extended yet)
		const candRes = await api.getCandidacy(adminToken, {
			candidacy_id: candidacyId,
		});
		expect(candRes.body.state).toBe("interviewing");
	});

	// ─── Step 5: Extend Offer ────────────────────────────────────────────────────

	test("Step 5 — Extending offer transitions candidacy to offered and cancels scheduled interviews", async ({
		request,
	}) => {
		// First schedule a second interview that should be auto-cancelled
		const api = new OrgAPIClient(request);
		const schedRes = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "in_person",
			starts_at: FUTURE_START,
			ends_at: FUTURE_END,
			interviewer_email_addresses: [interviewerEmail],
		});
		expect(schedRes.status).toBe(201);
		const secondInterviewId = schedRes.body.interview_id;

		// Extend the offer
		const offerRes = await api.extendOffer(
			adminToken,
			candidacyId,
			MINIMAL_PDF,
			{
				salary_currency: "USD",
				salary_amount: "150000",
				start_date: "2027-01-15",
				notes: "Welcome to the team! We are excited to have you on board.",
			}
		);
		expect(offerRes.status).toBe(201);
		expect(offerRes.body).toHaveProperty("candidacy_id", candidacyId);
		expect(offerRes.body).toHaveProperty("extended_at");

		// Candidacy is now offered
		const candRes = await api.getCandidacy(adminToken, {
			candidacy_id: candidacyId,
		});
		expect(candRes.status).toBe(200);
		expect(candRes.body.state).toBe("offered");

		// The second (scheduled) interview was auto-cancelled
		const ivRes = await api.getInterview(adminToken, {
			interview_id: secondInterviewId,
		});
		expect(ivRes.body.state).toBe("cancelled");

		// System comment was added
		expect(candRes.body.comments.length).toBeGreaterThan(0);
		const sysComment = candRes.body.comments.find(
			(c: { author_kind: string }) => c.author_kind === "system"
		);
		expect(sysComment).toBeDefined();

		// Audit log written
		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.extend_offer"],
		});
		const entry = auditRes.body?.audit_logs?.find(
			(e: { event_type: string }) => e.event_type === "org.extend_offer"
		);
		expect(entry).toBeDefined();
	});

	test("Cannot extend offer twice on the same candidacy", async ({
		request,
	}) => {
		// candidacy is already in offered state — should fail
		const api = new OrgAPIClient(request);
		const res = await api.extendOffer(adminToken, candidacyId, MINIMAL_PDF);
		expect(res.status).toBe(422);
	});

	// ─── Step 6: Request References ──────────────────────────────────────────────

	test("Step 6 — Can request references on an offered candidacy", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.requestReferences(adminToken, {
			candidacy_id: candidacyId,
			max_references: 2,
			response_deadline: "2027-06-30",
			questions: [
				{
					question_id: "q1",
					text: "How long did you work together and in what capacity?",
					min_chars: 50,
					max_chars: 2000,
					required: true,
				},
				{
					question_id: "q2",
					text: "How would you describe their technical problem-solving ability?",
					min_chars: 50,
					max_chars: 2000,
					required: true,
				},
			],
		});
		expect(res.status).toBe(201);
		expect(res.body).toHaveProperty("request_id");
		const requestId = res.body.request_id;

		// Nominations list is empty (no hub user has nominated yet)
		const nomRes = await api.listReferenceNominations(adminToken, {
			request_id: requestId,
		});
		expect(nomRes.status).toBe(200);
		expect(nomRes.body.nominations).toHaveLength(0);

		// Responses list is empty
		const respRes = await api.listReferenceResponses(adminToken, {
			request_id: requestId,
		});
		expect(respRes.status).toBe(200);
		expect(respRes.body.responses).toHaveLength(0);
		expect(respRes.body.declined_nominations).toHaveLength(0);
	});
});

// ─── extend-offer validation and RBAC tests ─────────────────────────────────

test.describe("Extend Offer — Validation and RBAC", () => {
	test.describe.configure({ mode: "serial" });

	const { email: adminEmail, domain: orgDomain } =
		generateTestOrgEmail("offer-rbac");
	// Org B: used to create a foreign candidacy for cross-org 404 test
	const { email: orgBEmail, domain: orgBDomain } =
		generateTestOrgEmail("offer-rbac-b");
	const noRoleEmail = generateOrgUserEmail("offer-norole", orgDomain);
	const managerEmail = generateOrgUserEmail("offer-mgr", orgDomain);
	const hubEmail = generateTestEmail("offer-hub");
	const hubBEmail = generateTestEmail("offer-hub-b");

	let adminToken: string;
	let noRoleToken: string;
	let managerToken: string;
	let orgId: string;
	let adminUserId: string;
	let hubUserGlobalId: string;
	let hubHandle: string;
	let candidacyId: string;
	let foreignCandidacyId: string; // belongs to org B; used for cross-org 404 test
	let interviewerEmail: string;

	test.beforeAll(async ({ request }) => {
		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		orgId = adminResult.orgId;
		adminUserId = adminResult.orgUserId;
		const orgApi = new OrgAPIClient(request);
		adminToken = await loginOrgUser(orgApi, adminEmail, orgDomain);

		await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
			orgId,
			domain: orgDomain,
		});
		noRoleToken = await loginOrgUser(orgApi, noRoleEmail, orgDomain);

		const mgrResult = await createTestOrgUserDirect(
			managerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain: orgDomain }
		);
		await assignRoleToOrgUser(mgrResult.orgUserId, "org:manage_candidacies");
		managerToken = await loginOrgUser(orgApi, managerEmail, orgDomain);

		const hubResult = await createTestHubUserDirect(
			hubEmail,
			TEST_PASSWORD,
			"offer-hub"
		);
		hubUserGlobalId = hubResult.hubUserGlobalId;
		hubHandle = hubResult.handle;

		const openingResult = await createTestOpeningDirect(
			orgId,
			adminUserId,
			"Offer RBAC Opening"
		);
		const appId = await createTestApplicationDirect(
			orgId,
			orgDomain,
			openingResult.openingId,
			openingResult.openingNumber,
			hubUserGlobalId,
			hubHandle,
			"Offer RBAC Candidate"
		);
		const shortlistRes = await orgApi.shortlistApplication(adminToken, {
			application_id: appId,
		});
		expect(shortlistRes.status).toBe(200);
		candidacyId = shortlistRes.body.candidacy_id;
		interviewerEmail = adminEmail;

		// Create org B + candidacy for cross-org 404 test
		const orgBResult = await createTestOrgAdminDirect(orgBEmail, TEST_PASSWORD);
		const hubBResult = await createTestHubUserDirect(
			hubBEmail,
			TEST_PASSWORD,
			"offer-hub-b"
		);
		const opB = await createTestOpeningDirect(
			orgBResult.orgId,
			orgBResult.orgUserId,
			"Offer B Opening"
		);
		const appB = await createTestApplicationDirect(
			orgBResult.orgId,
			orgBDomain,
			opB.openingId,
			opB.openingNumber,
			hubBResult.hubUserGlobalId,
			hubBResult.handle,
			"Offer B Candidate"
		);
		const srB = await orgApi.shortlistApplication(
			await loginOrgUser(orgApi, orgBEmail, orgBDomain),
			{ application_id: appB }
		);
		expect(srB.status).toBe(200);
		foreignCandidacyId = srB.body.candidacy_id;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(hubBEmail).catch(() => {});
		await deleteTestGlobalOrgDomain(orgBDomain).catch(() => {});
		await deleteTestHubUser(hubEmail);
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	test("extend-offer: no-role user → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.extendOffer(noRoleToken, candidacyId, MINIMAL_PDF);
		expect(res.status).toBe(403);
	});

	test("extend-offer: non-PDF file → 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const notPdf = Buffer.from("this is not a pdf file");
		const res = await api.extendOffer(managerToken, candidacyId, notPdf);
		expect(res.status).toBe(400);
	});

	test("extend-offer: org A token on org B's candidacy → 403 or 404", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		// foreignCandidacyId belongs to org B; adminToken belongs to org A
		const res = await api.extendOffer(
			adminToken,
			foreignCandidacyId,
			MINIMAL_PDF
		);
		expect([403, 404]).toContain(res.status);
	});

	test("extend-offer: manager with org:manage_candidacies → 201", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.extendOffer(managerToken, candidacyId, MINIMAL_PDF, {
			salary_currency: "INR",
			salary_amount: "4000000",
			start_date: "2027-03-01",
		});
		expect(res.status).toBe(201);
		expect(res.body).toHaveProperty("candidacy_id", candidacyId);
		expect(res.body).toHaveProperty("extended_at");

		// Candidacy transitions to offered
		const candRes = await api.getCandidacy(adminToken, {
			candidacy_id: candidacyId,
		});
		expect(candRes.body.state).toBe("offered");

		// Audit log written
		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.extend_offer"],
		});
		const entry = auditRes.body?.audit_logs?.find(
			(e: { event_type: string }) => e.event_type === "org.extend_offer"
		);
		expect(entry).toBeDefined();
	});

	test("extend-offer: 401 unauthenticated", async ({ request }) => {
		const res = await request.post("/org/extend-offer", {
			multipart: {
				candidacy_id: candidacyId,
				offer_letter: {
					name: "offer.pdf",
					mimeType: "application/pdf",
					buffer: MINIMAL_PDF,
				},
			},
		});
		expect(res.status()).toBe(401);
	});

	test("No audit log when extend-offer fails with 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const beforeRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.extend_offer"],
		});
		const beforeCount = beforeRes.body?.audit_logs?.length ?? 0;

		await api.extendOffer(noRoleToken, candidacyId, MINIMAL_PDF);

		const afterRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.extend_offer"],
		});
		expect(afterRes.body?.audit_logs?.length ?? 0).toBe(beforeCount);
	});
});
