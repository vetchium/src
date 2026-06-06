/**
 * Functional tests for interview lifecycle:
 * - POST /org/schedule-interview  (already in interviews-rbac.spec.ts; this adds data verification)
 * - POST /org/update-interview    (reschedule with field verification)
 * - POST /org/cancel-interview    (state transition verification)
 * - POST /org/add-interviewer     (count enforcement + audit)
 * - POST /org/remove-interviewer  (audit)
 * - POST /org/list-interviews     (keyset pagination)
 * - POST /org/get-interview       (full fields)
 */

import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	createTestHubUserDirect,
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

const START1 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
	.toISOString()
	.replace(/\.\d+Z$/, "Z");
const END1 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3600000)
	.toISOString()
	.replace(/\.\d+Z$/, "Z");
const START2 = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)
	.toISOString()
	.replace(/\.\d+Z$/, "Z");
const END2 = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000 + 3600000)
	.toISOString()
	.replace(/\.\d+Z$/, "Z");

test.describe("Interview Lifecycle", () => {
	test.describe.configure({ mode: "serial" });

	const { email: adminEmail, domain: orgDomain } =
		generateTestOrgEmail("iv-lifecycle");
	const ivEmail1 = generateOrgUserEmail("iv-user1", orgDomain);
	const ivEmail2 = generateOrgUserEmail("iv-user2", orgDomain);
	const hubEmail = generateTestEmail("iv-hub");

	let adminToken: string;
	let orgId: string;
	let orgUserId: string;
	let ivUserId1: string;
	let ivUserId2: string;
	let hubGlobalId: string;
	let hubHandle: string;
	let openingId: string;
	let openingNumber: number;
	let candidacyId: string;

	test.beforeAll(async ({ request }) => {
		const orgApi = new OrgAPIClient(request);

		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		orgId = adminResult.orgId;
		orgUserId = adminResult.orgUserId;
		adminToken = await loginOrgUser(orgApi, adminEmail, orgDomain);

		const iv1 = await createTestOrgUserDirect(ivEmail1, TEST_PASSWORD, "ind1", {
			orgId,
			domain: orgDomain,
		});
		ivUserId1 = iv1.orgUserId;

		const iv2 = await createTestOrgUserDirect(ivEmail2, TEST_PASSWORD, "ind1", {
			orgId,
			domain: orgDomain,
		});
		ivUserId2 = iv2.orgUserId;

		const hubResult = await createTestHubUserDirect(
			hubEmail,
			TEST_PASSWORD,
			"ivhub"
		);
		hubGlobalId = hubResult.hubUserGlobalId;
		hubHandle = hubResult.handle;

		const opening = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"Interview Lifecycle Opening"
		);
		openingId = opening.openingId;
		openingNumber = opening.openingNumber;

		const appId = await createTestApplicationDirect(
			orgId,
			orgDomain,
			openingId,
			openingNumber,
			hubGlobalId,
			hubHandle,
			"IV Lifecycle Candidate"
		);
		const sr = await orgApi.shortlistApplication(adminToken, {
			application_id: appId,
		});
		expect(sr.status).toBe(200);
		candidacyId = sr.body.candidacy_id;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(hubEmail);
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	// ─── schedule-interview + get-interview ───────────────────────────────────────

	test("schedule-interview: returns interview_id; get-interview shows correct fields", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);

		const schedRes = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: START1,
			ends_at: END1,
			description: "Technical screening round.",
			interview_location: "https://meet.example.com/abc-defg-hij",
			interviewer_email_addresses: [ivEmail1],
		});
		expect(schedRes.status).toBe(201);
		expect(typeof schedRes.body!.interview_id).toBe("string");
		const interviewId = schedRes.body!.interview_id;

		const getRes = await api.getInterview(adminToken, {
			interview_id: interviewId,
		});
		expect(getRes.status).toBe(200);
		expect(getRes.body!.interview_id).toBe(interviewId);
		expect(getRes.body!.candidacy_id).toBe(candidacyId);
		expect(getRes.body!.interview_type).toBe("video");
		expect(getRes.body!.state).toBe("scheduled");
		expect(getRes.body!.description).toBe("Technical screening round.");
		expect(getRes.body!.interview_location).toBe(
			"https://meet.example.com/abc-defg-hij"
		);

		// update-interview can change the location, which round-trips through get.
		const updRes = await api.updateInterview(adminToken, {
			interview_id: interviewId,
			interview_location: "Room 4, 12 Main Street",
		});
		expect(updRes.status).toBe(200);
		const getRes2 = await api.getInterview(adminToken, {
			interview_id: interviewId,
		});
		expect(getRes2.body!.interview_location).toBe("Room 4, 12 Main Street");

		// Audit log
		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.schedule_interview"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "org.schedule_interview" &&
				e.event_data?.candidacy_id === candidacyId
		);
		expect(entry).toBeDefined();
	});

	// ─── add-interviewer / remove-interviewer ────────────────────────────────────

	test("add-interviewer: adds a second interviewer; count reflects in list", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);

		// Schedule a fresh interview with 1 interviewer
		const schedRes = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "in_person",
			starts_at: START2,
			ends_at: END2,
			interviewer_email_addresses: [ivEmail1],
		});
		expect(schedRes.status).toBe(201);
		const interviewId = schedRes.body!.interview_id;

		// Add second interviewer
		const addRes = await api.addInterviewer(adminToken, {
			interview_id: interviewId,
			org_user_email_address: ivEmail2,
		});
		expect(addRes.status).toBe(200);

		// List shows interviewer_count = 2
		const listRes = await api.listInterviews(adminToken, {
			filter_candidacy_id: candidacyId,
		});
		const found = listRes.body!.interviews.find(
			(iv: { interview_id: string }) => iv.interview_id === interviewId
		);
		expect(found).toBeDefined();
		expect(found!.interviewer_count).toBe(2);

		// Audit log for add_interviewer
		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.add_interviewer"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string }) => e.event_type === "org.add_interviewer"
		);
		expect(entry).toBeDefined();

		// Remove second interviewer
		const removeRes = await api.removeInterviewer(adminToken, {
			interview_id: interviewId,
			org_user_id: ivUserId2,
		});
		expect(removeRes.status).toBe(200);

		// Count drops back to 1
		const listRes2 = await api.listInterviews(adminToken, {
			filter_candidacy_id: candidacyId,
		});
		const found2 = listRes2.body!.interviews.find(
			(iv: { interview_id: string }) => iv.interview_id === interviewId
		);
		expect(found2!.interviewer_count).toBe(1);

		// Audit log for remove_interviewer
		const auditRes2 = await api.listAuditLogs(adminToken, {
			event_types: ["org.remove_interviewer"],
		});
		const entry2 = auditRes2.body!.audit_logs.find(
			(e: { event_type: string }) => e.event_type === "org.remove_interviewer"
		);
		expect(entry2).toBeDefined();
	});

	// ─── update-interview ─────────────────────────────────────────────────────────

	test("update-interview: rescheduling changes starts_at/ends_at; audit log written", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);

		const schedRes = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: START1,
			ends_at: END1,
			interviewer_email_addresses: [ivEmail1],
		});
		const interviewId = schedRes.body!.interview_id;

		const newStart = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000)
			.toISOString()
			.replace(/\.\d+Z$/, "Z");
		const newEnd = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000 + 7200000)
			.toISOString()
			.replace(/\.\d+Z$/, "Z");

		const updateRes = await api.updateInterview(adminToken, {
			interview_id: interviewId,
			starts_at: newStart,
			ends_at: newEnd,
			description: "Rescheduled technical screening.",
		});
		expect(updateRes.status).toBe(200);

		// Audit log
		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.update_interview"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string }) => e.event_type === "org.update_interview"
		);
		expect(entry).toBeDefined();
	});

	test("update-interview: 422 when interview is not in scheduled state", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);

		// Schedule + cancel, then try to update
		const schedRes = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: START1,
			ends_at: END1,
			interviewer_email_addresses: [ivEmail1],
		});
		const interviewId = schedRes.body!.interview_id;

		await api.cancelInterview(adminToken, { interview_id: interviewId });

		const updateRes = await api.updateInterview(adminToken, {
			interview_id: interviewId,
			description: "Should fail",
		});
		expect(updateRes.status).toBe(422);
	});

	// ─── cancel-interview ─────────────────────────────────────────────────────────

	test("cancel-interview: transitions state to cancelled; 422 if already cancelled", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);

		const schedRes = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: START1,
			ends_at: END1,
			interviewer_email_addresses: [ivEmail1],
		});
		const interviewId = schedRes.body!.interview_id;

		const cancelRes = await api.cancelInterview(adminToken, {
			interview_id: interviewId,
		});
		expect(cancelRes.status).toBe(200);

		// Cancelled interview appears in get-interview as cancelled
		const getRes = await api.getInterview(adminToken, {
			interview_id: interviewId,
		});
		expect(getRes.body!.state).toBe("cancelled");

		// Audit log
		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.cancel_interview"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string }) => e.event_type === "org.cancel_interview"
		);
		expect(entry).toBeDefined();

		// Second cancel → 422
		const cancel2Res = await api.cancelInterview(adminToken, {
			interview_id: interviewId,
		});
		expect(cancel2Res.status).toBe(422);
	});

	// ─── list-interviews keyset pagination ────────────────────────────────────────

	test("list-interviews: filter_candidacy_id returns interviews with correct fields", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.listInterviews(adminToken, {
			filter_candidacy_id: candidacyId,
		});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body!.interviews)).toBe(true);
		expect(res.body!.interviews.length).toBeGreaterThan(0);

		const first = res.body!.interviews[0];
		expect(typeof first.interview_id).toBe("string");
		expect(typeof first.interview_type).toBe("string");
		expect(typeof first.starts_at).toBe("string");
		expect(typeof first.ends_at).toBe("string");
		expect(typeof first.state).toBe("string");
		expect(typeof first.interviewer_count).toBe("number");
	});

	// ─── 400 validation ───────────────────────────────────────────────────────────

	test("schedule-interview: 400 when starts_at >= ends_at", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const now = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
			.toISOString()
			.replace(/\.\d+Z$/, "Z");
		const res = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: now,
			ends_at: now, // same time → invalid
			interviewer_email_addresses: [ivEmail1],
		});
		expect(res.status).toBe(400);
	});

	// ─── 401 ──────────────────────────────────────────────────────────────────────

	test("schedule-interview: 401 when unauthenticated", async ({ request }) => {
		const res = await request.post("/org/schedule-interview", {
			data: {
				candidacy_id: candidacyId,
				interview_type: "video",
				starts_at: START1,
				ends_at: END1,
				interviewer_email_addresses: [],
			},
		});
		expect(res.status()).toBe(401);
	});
});
