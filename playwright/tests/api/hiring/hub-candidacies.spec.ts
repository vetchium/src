/**
 * Tests for hub-side candidacy endpoints:
 * - POST /hub/get-my-candidacy
 * - POST /hub/rsvp-interview (hub candidate perspective)
 * - POST /hub/list-my-candidacies (keyset pagination)
 */

import { test, expect } from "@playwright/test";
import { HubAPIClient } from "../../../lib/hub-api-client";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestHubUserDirect,
	createTestOrgAdminDirect,
	deleteTestHubUser,
	generateTestEmail,
	generateTestOrgEmail,
	generateOrgUserEmail,
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

const FUTURE_START = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
	.toISOString()
	.replace(/\.\d+Z$/, "Z");
const FUTURE_END = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000 + 3600000)
	.toISOString()
	.replace(/\.\d+Z$/, "Z");

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

test.describe("Hub Candidacies", () => {
	test.describe.configure({ mode: "serial" });

	const { email: orgEmail, domain: orgDomain } =
		generateTestOrgEmail("hub-cand-tests");
	const hubEmail = generateTestEmail("hub-cand-user");
	const interviewerEmail = generateOrgUserEmail("hub-cand-ivr", orgDomain);

	let hubToken: string;
	let hubGlobalId: string;
	let hubHandle: string;
	let orgToken: string;
	let orgId: string;
	let orgUserId: string;
	let openingId: string;
	let openingNumber: number;
	let candidacyId: string;
	let interviewId: string;
	let interviewerUserId: string;

	test.beforeAll(async ({ request }) => {
		const hubResult = await createTestHubUserDirect(
			hubEmail,
			TEST_PASSWORD,
			"hubcanduser"
		);
		hubToken = hubResult.sessionToken;
		hubGlobalId = hubResult.hubUserGlobalId;
		hubHandle = hubResult.handle;

		const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
		orgId = orgResult.orgId;
		orgUserId = orgResult.orgUserId;
		const orgApi = new OrgAPIClient(request);
		orgToken = await loginOrgUser(orgApi, orgEmail, orgDomain);

		const opening = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"Hub Cand Opening"
		);
		openingId = opening.openingId;
		openingNumber = opening.openingNumber;

		// Create application + shortlist to get a candidacy
		const appId = await createTestApplicationDirect(
			orgId,
			orgDomain,
			openingId,
			openingNumber,
			hubGlobalId,
			hubHandle,
			"Hub Cand Candidate"
		);
		const shortlistRes = await orgApi.shortlistApplication(orgToken, {
			application_id: appId,
		});
		expect(shortlistRes.status).toBe(200);
		candidacyId = shortlistRes.body.candidacy_id;

		// Create interviewer user and schedule interview
		const { createTestOrgUserDirect, assignRoleToOrgUser } =
			await import("../../../lib/db");
		const ivResult = await createTestOrgUserDirect(
			interviewerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain: orgDomain }
		);
		interviewerUserId = ivResult.orgUserId;

		const schedRes = await orgApi.scheduleInterview(orgToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: FUTURE_START,
			ends_at: FUTURE_END,
			interviewer_email_addresses: [interviewerEmail],
		});
		expect(schedRes.status).toBe(201);
		interviewId = schedRes.body.interview_id;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(hubEmail);
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	// ─── list-my-candidacies ──────────────────────────────────────────────────────

	test("list-my-candidacies: hub user's candidacy appears with correct fields", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const res = await hubClient.listMyCandidacies(hubToken, {});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body!.candidacies)).toBe(true);

		const found = res.body!.candidacies.find(
			(c: { candidacy_id: string }) => c.candidacy_id === candidacyId
		);
		expect(found).toBeDefined();
		expect(found!.state).toBe("interviewing");
		expect(typeof found!.opening_title).toBe("string");
		expect(found!.opening_title).toBe("Hub Cand Opening");
		expect(typeof found!.created_at).toBe("string");
	});

	test("list-my-candidacies: 401 when not authenticated", async ({
		request,
	}) => {
		const res = await request.post("/hub/list-my-candidacies", { data: {} });
		expect(res.status()).toBe(401);
	});

	// ─── get-my-candidacy ─────────────────────────────────────────────────────────

	test("get-my-candidacy: returns full detail with interviews and comments", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const res = await hubClient.getMyCandidacy(hubToken, {
			candidacy_id: candidacyId,
		});
		expect(res.status).toBe(200);
		expect(res.body!.candidacy_id).toBe(candidacyId);
		expect(res.body!.state).toBe("interviewing");
		expect(res.body!.opening_title).toBe("Hub Cand Opening");
		expect(Array.isArray(res.body!.interviews)).toBe(true);
		expect(res.body!.interviews.length).toBeGreaterThan(0);

		const interview = res.body!.interviews[0];
		expect(interview.interview_id).toBe(interviewId);
		expect(interview.interview_type).toBe("video");
		expect(interview.state).toBe("scheduled");
		expect(Array.isArray(res.body!.comments)).toBe(true);
		expect(res.body!.offer).toBeUndefined();
	});

	test("get-my-candidacy: 404 when candidacy belongs to another user", async ({
		request,
	}) => {
		const otherEmail = generateTestEmail("other-hub");
		const otherHub = await createTestHubUserDirect(
			otherEmail,
			TEST_PASSWORD,
			"otherhub"
		);
		await deleteTestHubUser(otherEmail).catch(() => {});

		const hubClient = new HubAPIClient(request);
		const res = await hubClient.getMyCandidacy(otherHub.sessionToken, {
			candidacy_id: candidacyId,
		});
		expect(res.status).toBe(404);
	});

	test("get-my-candidacy: 401 when not authenticated", async ({ request }) => {
		const res = await request.post("/hub/get-my-candidacy", {
			data: { candidacy_id: candidacyId },
		});
		expect(res.status()).toBe(401);
	});

	// ─── rsvp-interview (hub candidate) ──────────────────────────────────────────

	test("hub rsvp-interview: candidate RSVPs yes — can change to no", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);

		const yesRes = await hubClient.rsvpInterview(hubToken, {
			interview_id: interviewId,
			rsvp: "yes",
		});
		expect(yesRes.status).toBe(200);

		// Audit log
		const auditRes = await hubClient.listAuditLogs(hubToken, {
			event_types: ["hub.rsvp_interview"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "hub.rsvp_interview" &&
				e.event_data?.interview_id === interviewId
		);
		expect(entry).toBeDefined();

		// Change RSVP to no
		const noRes = await hubClient.rsvpInterview(hubToken, {
			interview_id: interviewId,
			rsvp: "no",
		});
		expect(noRes.status).toBe(200);

		// Candidacy detail shows the updated RSVP
		const candRes = await hubClient.getMyCandidacy(hubToken, {
			candidacy_id: candidacyId,
		});
		const interview = candRes.body!.interviews.find(
			(iv: { interview_id: string }) => iv.interview_id === interviewId
		);
		expect(interview).toBeDefined();
		expect(interview!.candidate_rsvp).toBe("no");
	});

	test("hub rsvp-interview: 403 when interview does not belong to caller's candidacy", async ({
		request,
	}) => {
		// Another hub user tries to RSVP on this interview
		const otherEmail = generateTestEmail("other-rsvp-hub");
		const otherHub = await createTestHubUserDirect(
			otherEmail,
			TEST_PASSWORD,
			"otherrsvp"
		);
		await deleteTestHubUser(otherEmail).catch(() => {});

		const hubClient = new HubAPIClient(request);
		const res = await hubClient.rsvpInterview(otherHub.sessionToken, {
			interview_id: interviewId,
			rsvp: "yes",
		});
		expect(res.status).toBe(403);
	});

	test("hub rsvp-interview: 401 when not authenticated", async ({
		request,
	}) => {
		const res = await request.post("/hub/rsvp-interview", {
			data: { interview_id: interviewId, rsvp: "yes" },
		});
		expect(res.status()).toBe(401);
	});
});
