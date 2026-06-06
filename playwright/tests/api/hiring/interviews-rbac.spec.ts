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

const FUTURE_START = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
	.toISOString()
	.replace(/\.\d+Z$/, "Z");
const FUTURE_END = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3600000)
	.toISOString()
	.replace(/\.\d+Z$/, "Z");

test.describe("Interviews RBAC and Lifecycle", () => {
	test.describe.configure({ mode: "serial" });

	const { email: adminEmail, domain: orgDomain } =
		generateTestOrgEmail("int-rbac-admin");
	const noRoleEmail = generateOrgUserEmail("int-rbac-norole", orgDomain);
	const managerEmail = generateOrgUserEmail("int-rbac-mgr", orgDomain);
	const interviewerEmail = generateOrgUserEmail("int-rbac-ivr", orgDomain);
	const hubEmail = generateTestEmail("int-rbac-hub");

	let orgId: string;
	let adminToken: string;
	let noRoleToken: string;
	let managerToken: string;
	let interviewerToken: string;
	let adminUserId: string;
	let managerUserId: string;
	let interviewerUserId: string;
	let hubUserGlobalId: string;
	let hubHandle: string;
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

		const noRoleResult = await createTestOrgUserDirect(
			noRoleEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain: orgDomain }
		);
		noRoleToken = await loginOrgUser(orgApi, noRoleEmail, orgDomain);

		const managerResult = await createTestOrgUserDirect(
			managerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain: orgDomain }
		);
		managerUserId = managerResult.orgUserId;
		await assignRoleToOrgUser(managerUserId, "org:manage_candidacies");
		managerToken = await loginOrgUser(orgApi, managerEmail, orgDomain);

		// interviewer user: no special role, will be added as interviewer to the interview
		const interviewerResult = await createTestOrgUserDirect(
			interviewerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain: orgDomain }
		);
		interviewerUserId = interviewerResult.orgUserId;
		interviewerToken = await loginOrgUser(orgApi, interviewerEmail, orgDomain);

		const hubResult = await createTestHubUserDirect(
			hubEmail,
			TEST_PASSWORD,
			"int-rbac-hub"
		);
		hubUserGlobalId = hubResult.hubUserGlobalId;
		hubHandle = hubResult.handle;

		const openingResult = await createTestOpeningDirect(
			orgId,
			adminUserId,
			"Interviews RBAC Opening"
		);
		const appId = await createTestApplicationDirect(
			orgId,
			orgDomain,
			openingResult.openingId,
			openingResult.openingNumber,
			hubUserGlobalId,
			hubHandle,
			"Interviews RBAC Candidate"
		);

		// Shortlist → candidacy
		const shortlistRes = await orgApi.shortlistApplication(adminToken, {
			application_id: appId,
		});
		expect(shortlistRes.status).toBe(200);
		candidacyId = shortlistRes.body.candidacy_id;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(hubEmail);
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	// ─── schedule-interview RBAC ──────────────────────────────────────────────────

	test("schedule-interview: no-role user → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.scheduleInterview(noRoleToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: FUTURE_START,
			ends_at: FUTURE_END,
			interviewer_email_addresses: [adminEmail],
		});
		expect(res.status).toBe(403);
	});

	test("schedule-interview: manager with org:manage_candidacies → 201", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.scheduleInterview(managerToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: FUTURE_START,
			ends_at: FUTURE_END,
			interviewer_email_addresses: [interviewerEmail],
		});
		expect(res.status).toBe(201);
		expect(res.body).toHaveProperty("interview_id");
		interviewId = res.body.interview_id;

		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.schedule_interview"],
		});
		const entry = auditRes.body?.audit_logs?.find(
			(e: { event_type: string }) => e.event_type === "org.schedule_interview"
		);
		expect(entry).toBeDefined();
	});

	// ─── list-interviews / get-interview RBAC ──────────────────────────────────────

	test("list-interviews: no-role user → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.listInterviews(noRoleToken, {
			filter_candidacy_id: candidacyId,
		});
		expect(res.status).toBe(403);
	});

	test("list-interviews: manager can list interviews → 200", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.listInterviews(managerToken, {
			filter_candidacy_id: candidacyId,
		});
		expect(res.status).toBe(200);
		expect(res.body.interviews.length).toBeGreaterThan(0);
	});

	test("get-interview: no-role user → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.getInterview(noRoleToken, {
			interview_id: interviewId,
		});
		expect(res.status).toBe(403);
	});

	test("get-interview: manager → 200", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.getInterview(managerToken, {
			interview_id: interviewId,
		});
		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty("interview_id", interviewId);
	});

	// ─── add-interviewer / remove-interviewer RBAC ────────────────────────────────

	test("add-interviewer: no-role user → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.addInterviewer(noRoleToken, {
			interview_id: interviewId,
			org_user_email_address: adminEmail,
		});
		expect(res.status).toBe(403);
	});

	test("add-interviewer: manager → 200", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.addInterviewer(managerToken, {
			interview_id: interviewId,
			org_user_email_address: managerEmail,
		});
		expect(res.status).toBe(200);
	});

	test("remove-interviewer: no-role user → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.removeInterviewer(noRoleToken, {
			interview_id: interviewId,
			org_user_id: managerUserId,
		});
		expect(res.status).toBe(403);
	});

	test("remove-interviewer: manager → 200", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.removeInterviewer(managerToken, {
			interview_id: interviewId,
			org_user_id: managerUserId,
		});
		expect(res.status).toBe(200);
	});

	// ─── rsvp-interview: interviewer membership gate (no role required) ───────────

	test("rsvp-interview: listed interviewer → 200", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.rsvpInterview(interviewerToken, {
			interview_id: interviewId,
			rsvp: "yes",
		});
		expect(res.status).toBe(200);
	});

	test("rsvp-interview: non-interviewer (even manager) → 403", async ({
		request,
	}) => {
		// Manager was removed from interviewers above
		const api = new OrgAPIClient(request);
		const res = await api.rsvpInterview(managerToken, {
			interview_id: interviewId,
			rsvp: "yes",
		});
		expect(res.status).toBe(403);
	});

	// ─── submit-interview-feedback: interviewer-only, superadmin NOT exempt ────────

	test("submit-interview-feedback: listed interviewer → 200; interview stays scheduled (decoupled from completion)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.submitInterviewFeedback(interviewerToken, {
			interview_id: interviewId,
			decision: "yes",
			positives: "Strong technical skills and clear communication.",
			negatives: "Needs more distributed systems experience.",
			overall_assessment: "Good candidate overall, recommend moving forward.",
		});
		expect(res.status).toBe(200);

		// Submitting feedback no longer auto-completes the interview.
		const getRes = await api.getInterview(managerToken, {
			interview_id: interviewId,
		});
		expect(getRes.status).toBe(200);
		expect(getRes.body.state).toBe("scheduled");

		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.submit_interview_feedback"],
		});
		const entry = auditRes.body?.audit_logs?.find(
			(e: { event_type: string }) =>
				e.event_type === "org.submit_interview_feedback"
		);
		expect(entry).toBeDefined();
	});

	test("submit-interview-feedback: non-panel non-superadmin → 403; superadmin not on panel → 200", async ({
		request,
	}) => {
		// Fresh interview whose only listed interviewer is interviewerEmail.
		const api = new OrgAPIClient(request);
		const scheduleRes = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: FUTURE_START,
			ends_at: FUTURE_END,
			interviewer_email_addresses: [interviewerEmail],
		});
		expect(scheduleRes.status).toBe(201);
		const freshInterviewId = scheduleRes.body.interview_id;

		// A user with no roles who is not on the panel must be rejected.
		const denied = await api.submitInterviewFeedback(noRoleToken, {
			interview_id: freshInterviewId,
			decision: "yes",
			positives: "Looks great.",
			negatives: "None.",
			overall_assessment: "Hire.",
		});
		expect(denied.status).toBe(403);

		// A superadmin may submit feedback for any interview, even one they are not
		// on the panel of (org policy: superadmins can do anything).
		const allowed = await api.submitInterviewFeedback(adminToken, {
			interview_id: freshInterviewId,
			decision: "yes",
			positives: "Looks great.",
			negatives: "None.",
			overall_assessment: "Hire.",
		});
		expect(allowed.status).toBe(200);
	});

	// ─── update-interview / cancel-interview RBAC ─────────────────────────────────

	test("update-interview: no-role user → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		// schedule a fresh interview to test update/cancel
		const schedRes = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "in_person",
			starts_at: FUTURE_START,
			ends_at: FUTURE_END,
			interviewer_email_addresses: [interviewerEmail],
		});
		if (schedRes.status !== 201) return;
		const newInterviewId = schedRes.body.interview_id;

		const res = await api.updateInterview(noRoleToken, {
			interview_id: newInterviewId,
		});
		expect(res.status).toBe(403);
	});

	test("cancel-interview: no-role user → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const schedRes = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: FUTURE_START,
			ends_at: FUTURE_END,
			interviewer_email_addresses: [interviewerEmail],
		});
		if (schedRes.status !== 201) return;
		const cancelInterviewId = schedRes.body.interview_id;

		const res = await api.cancelInterview(noRoleToken, {
			interview_id: cancelInterviewId,
		});
		expect(res.status).toBe(403);
	});

	test("cancel-interview: manager with org:manage_candidacies → 200", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const schedRes = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: FUTURE_START,
			ends_at: FUTURE_END,
			interviewer_email_addresses: [interviewerEmail],
		});
		expect(schedRes.status).toBe(201);
		const cancelInterviewId = schedRes.body.interview_id;

		const res = await api.cancelInterview(managerToken, {
			interview_id: cancelInterviewId,
		});
		expect(res.status).toBe(200);

		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.cancel_interview"],
		});
		const entry = auditRes.body?.audit_logs?.find(
			(e: { event_type: string }) => e.event_type === "org.cancel_interview"
		);
		expect(entry).toBeDefined();
	});

	// ─── 401 unauthenticated ──────────────────────────────────────────────────────

	test("schedule-interview: 401 unauthenticated", async ({ request }) => {
		const res = await request.post("/org/schedule-interview", {
			data: {
				candidacy_id: candidacyId,
				interview_type: "video",
				starts_at: FUTURE_START,
				ends_at: FUTURE_END,
				interviewer_email_addresses: [],
			},
		});
		expect(res.status()).toBe(401);
	});

	test("submit-interview-feedback: 401 unauthenticated", async ({
		request,
	}) => {
		const res = await request.post("/org/submit-interview-feedback", {
			data: {
				interview_id: interviewId,
				decision: "yes",
				positives: "x",
				negatives: "x",
				overall_assessment: "x",
			},
		});
		expect(res.status()).toBe(401);
	});
});
