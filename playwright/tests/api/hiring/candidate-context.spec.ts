/**
 * Tests for the HR/interviewer candidate-context enrichment:
 * - get-candidacy returns cover_letter + resume_download_url
 * - get-interview returns candidate_handle/display_name/opening_title + resume URL
 * - GET /org/candidacy-resume/{candidacyId}  (HR; org-scoped)
 * - GET /org/interview-resume/{interviewId}  (panel member or superadmin)
 *
 * The candidate applies through the real multipart flow so an actual resume
 * exists in S3 and the streaming endpoints return it.
 */

import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import { HubAPIClient } from "../../../lib/hub-api-client";
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
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";

const MINIMAL_PDF = Buffer.from(
	"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
);
const COVER_LETTER =
	"I am very excited to apply for this role. I bring deep experience across the stack " +
	"and a track record of shipping reliable systems, and I would love to contribute here.";
const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";
const FUTURE_START = new Date(Date.now() + 7 * 86400000)
	.toISOString()
	.replace(/\.\d+Z$/, "Z");
const FUTURE_END = new Date(Date.now() + 7 * 86400000 + 3600000)
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

test.describe("Candidate context + resume", () => {
	test.describe.configure({ mode: "serial" });

	const { email: adminEmail, domain: orgDomain } =
		generateTestOrgEmail("cand-ctx");
	const { email: orgBEmail, domain: orgBDomain } =
		generateTestOrgEmail("cand-ctx-b");
	const ivEmail = generateOrgUserEmail("cand-ctx-ivr", orgDomain);
	const managerEmail = generateOrgUserEmail("cand-ctx-mgr", orgDomain);
	const hubEmail = generateTestEmail("cand-ctx-hub");

	let adminToken: string;
	let orgBToken: string;
	let ivToken: string;
	let managerToken: string;
	let orgId: string;
	let adminUserId: string;
	let candidacyId: string;
	let interviewId: string;

	test.beforeAll(async ({ request }) => {
		const orgApi = new OrgAPIClient(request);
		const hubApi = new HubAPIClient(request);

		const admin = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		orgId = admin.orgId;
		adminUserId = admin.orgUserId;
		adminToken = await loginOrgUser(orgApi, adminEmail, orgDomain);

		await createTestOrgAdminDirect(orgBEmail, TEST_PASSWORD);
		orgBToken = await loginOrgUser(orgApi, orgBEmail, orgBDomain);

		await createTestOrgUserDirect(ivEmail, TEST_PASSWORD, "ind1", {
			orgId,
			domain: orgDomain,
		});
		ivToken = await loginOrgUser(orgApi, ivEmail, orgDomain);

		const mgr = await createTestOrgUserDirect(
			managerEmail,
			TEST_PASSWORD,
			"ind1",
			{
				orgId,
				domain: orgDomain,
			}
		);
		await assignRoleToOrgUser(mgr.orgUserId, "org:manage_candidacies");
		managerToken = await loginOrgUser(orgApi, managerEmail, orgDomain);

		const hub = await createTestHubUserDirect(
			hubEmail,
			TEST_PASSWORD,
			"candctx"
		);
		const opening = await createTestOpeningDirect(
			orgId,
			adminUserId,
			"Candidate Context Opening"
		);

		// Real application (uploads a resume to S3).
		const applyRes = await hubApi.applyForOpeningMultipart(hub.sessionToken, {
			org_domain: orgDomain,
			opening_number: opening.openingNumber,
			cover_letter: COVER_LETTER,
			resume: MINIMAL_PDF,
		});
		expect(applyRes.status).toBe(201);
		const applicationId = applyRes.body!.application_id;

		const sr = await orgApi.shortlistApplication(adminToken, {
			application_id: applicationId,
		});
		expect(sr.status).toBe(200);
		candidacyId = sr.body.candidacy_id;

		const sched = await orgApi.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: FUTURE_START,
			ends_at: FUTURE_END,
			interviewer_email_addresses: [ivEmail],
		});
		expect(sched.status).toBe(201);
		interviewId = sched.body!.interview_id;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(hubEmail).catch(() => {});
		await deleteTestGlobalOrgDomain(orgDomain).catch(() => {});
		await deleteTestGlobalOrgDomain(orgBDomain).catch(() => {});
	});

	// ─── get-candidacy enrichment ─────────────────────────────────────────────────

	test("get-candidacy returns cover_letter and a resume download URL", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.getCandidacy(adminToken, {
			candidacy_id: candidacyId,
		});
		expect(res.status).toBe(200);
		expect(res.body.cover_letter).toBe(COVER_LETTER);
		expect(res.body.resume_download_url).toBe(
			`/org/candidacy-resume/${candidacyId}`
		);
	});

	// ─── candidacy-resume ─────────────────────────────────────────────────────────

	test("candidacy-resume: HR downloads the resume PDF → 200", async ({
		request,
	}) => {
		const res = await request.get(`/org/candidacy-resume/${candidacyId}`, {
			headers: { Authorization: `Bearer ${adminToken}` },
		});
		expect(res.status()).toBe(200);
		const body = await res.body();
		expect(body.subarray(0, 4).toString()).toBe("%PDF");
	});

	test("candidacy-resume: another org → 403", async ({ request }) => {
		const res = await request.get(`/org/candidacy-resume/${candidacyId}`, {
			headers: { Authorization: `Bearer ${orgBToken}` },
		});
		expect(res.status()).toBe(403);
	});

	test("candidacy-resume: nonexistent → 404", async ({ request }) => {
		const res = await request.get(`/org/candidacy-resume/${NONEXISTENT_ID}`, {
			headers: { Authorization: `Bearer ${adminToken}` },
		});
		expect(res.status()).toBe(404);
	});

	test("candidacy-resume: unauthenticated → 401", async ({ request }) => {
		const res = await request.get(`/org/candidacy-resume/${candidacyId}`);
		expect(res.status()).toBe(401);
	});

	// ─── get-interview enrichment ─────────────────────────────────────────────────

	test("get-interview returns candidate context and a resume URL", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.getInterview(adminToken, {
			interview_id: interviewId,
		});
		expect(res.status).toBe(200);
		expect(typeof res.body.candidate_handle).toBe("string");
		expect(res.body.candidate_handle.length).toBeGreaterThan(0);
		expect(res.body.candidate_display_name.length).toBeGreaterThan(0);
		expect(res.body.opening_title).toBe("Candidate Context Opening");
		expect(res.body.resume_download_url).toBe(
			`/org/interview-resume/${interviewId}`
		);
	});

	// ─── interview-resume ─────────────────────────────────────────────────────────

	test("interview-resume: panel member downloads the resume → 200", async ({
		request,
	}) => {
		const res = await request.get(`/org/interview-resume/${interviewId}`, {
			headers: { Authorization: `Bearer ${ivToken}` },
		});
		expect(res.status()).toBe(200);
		const body = await res.body();
		expect(body.subarray(0, 4).toString()).toBe("%PDF");
	});

	test("interview-resume: superadmin not on the panel → 200", async ({
		request,
	}) => {
		const res = await request.get(`/org/interview-resume/${interviewId}`, {
			headers: { Authorization: `Bearer ${adminToken}` },
		});
		expect(res.status()).toBe(200);
	});

	test("interview-resume: non-panel non-superadmin → 403", async ({
		request,
	}) => {
		const res = await request.get(`/org/interview-resume/${interviewId}`, {
			headers: { Authorization: `Bearer ${managerToken}` },
		});
		expect(res.status()).toBe(403);
	});

	test("interview-resume: nonexistent → 404", async ({ request }) => {
		const res = await request.get(`/org/interview-resume/${NONEXISTENT_ID}`, {
			headers: { Authorization: `Bearer ${adminToken}` },
		});
		expect(res.status()).toBe(404);
	});

	test("interview-resume: unauthenticated → 401", async ({ request }) => {
		const res = await request.get(`/org/interview-resume/${interviewId}`);
		expect(res.status()).toBe(401);
	});
});
