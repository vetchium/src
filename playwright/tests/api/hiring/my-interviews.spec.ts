/**
 * Flat "My Interviews" list endpoints:
 *  - POST /org/list-my-interviews  → interviews the calling org user is an
 *    interviewer on, across the whole org, soonest first.
 *  - POST /hub/list-my-interviews  → the candidate's interviews across all
 *    their candidacies, soonest first.
 *
 * Covers: success/shape, scoping (only the caller's interviews), filter_state,
 * keyset pagination, validation (400), and auth (401).
 */

import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import { HubAPIClient } from "../../../lib/hub-api-client";
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

function futureSlot(daysAhead: number): { start: string; end: string } {
	const base = Date.now() + daysAhead * 24 * 60 * 60 * 1000;
	return {
		start: new Date(base).toISOString().replace(/\.\d+Z$/, "Z"),
		end: new Date(base + 3600000).toISOString().replace(/\.\d+Z$/, "Z"),
	};
}

test.describe("My Interviews (flat lists)", () => {
	test.describe.configure({ mode: "serial" });

	const { email: adminEmail, domain: orgDomain } =
		generateTestOrgEmail("my-iv");
	const interviewerEmail = generateOrgUserEmail("my-iv-er", orgDomain);
	const otherOrgUserEmail = generateOrgUserEmail("my-iv-other", orgDomain);
	const hubEmail = generateTestEmail("my-iv-hub");

	let adminToken: string;
	let interviewerToken: string;
	let otherToken: string;
	let hubToken: string;
	let orgId: string;
	let orgUserId: string;
	let candidacyId: string;
	const scheduledInterviewIds: string[] = [];

	test.beforeAll(async ({ request }) => {
		const orgApi = new OrgAPIClient(request);

		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		orgId = adminResult.orgId;
		orgUserId = adminResult.orgUserId;
		adminToken = await loginOrgUser(orgApi, adminEmail, orgDomain);

		await createTestOrgUserDirect(interviewerEmail, TEST_PASSWORD, "ind1", {
			orgId,
			domain: orgDomain,
		});
		interviewerToken = await loginOrgUser(orgApi, interviewerEmail, orgDomain);

		await createTestOrgUserDirect(otherOrgUserEmail, TEST_PASSWORD, "ind1", {
			orgId,
			domain: orgDomain,
		});
		otherToken = await loginOrgUser(orgApi, otherOrgUserEmail, orgDomain);

		const hubResult = await createTestHubUserDirect(
			hubEmail,
			TEST_PASSWORD,
			"myivhub"
		);
		hubToken = hubResult.sessionToken;

		const opening = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"My Interviews Opening"
		);
		const appId = await createTestApplicationDirect(
			orgId,
			orgDomain,
			opening.openingId,
			opening.openingNumber,
			hubResult.hubUserGlobalId,
			hubResult.handle,
			"My Interviews Candidate"
		);
		const sr = await orgApi.shortlistApplication(adminToken, {
			application_id: appId,
		});
		expect(sr.status).toBe(200);
		candidacyId = sr.body.candidacy_id;

		// Two interviews, both with `interviewerEmail` on the panel.
		for (const days of [3, 5]) {
			const slot = futureSlot(days);
			const res = await orgApi.scheduleInterview(adminToken, {
				candidacy_id: candidacyId,
				interview_type: "video",
				starts_at: slot.start,
				ends_at: slot.end,
				interviewer_email_addresses: [interviewerEmail],
			});
			expect(res.status).toBe(201);
			scheduledInterviewIds.push(res.body!.interview_id);
		}
	});

	test.afterAll(async () => {
		await deleteTestHubUser(hubEmail);
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	// ─── org/list-my-interviews ──────────────────────────────────────────────

	test("org: interviewer sees both assigned interviews, soonest first", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.listMyInterviews(interviewerToken, {});
		expect(res.status).toBe(200);
		expect(res.body!.interviews.length).toBeGreaterThanOrEqual(2);

		const mine = res.body!.interviews.filter((iv) =>
			scheduledInterviewIds.includes(iv.interview_id)
		);
		expect(mine.length).toBe(2);

		// Ascending by starts_at.
		const times = mine.map((iv) => new Date(iv.starts_at).getTime());
		expect(times[0]).toBeLessThanOrEqual(times[1]);

		// Context fields are populated.
		expect(mine[0].opening_title).toBe("My Interviews Opening");
		expect(mine[0].candidate_name).toBe("My Interviews Candidate");
		expect(mine[0].candidacy_id).toBe(candidacyId);
		expect(mine[0].feedback_submitted).toBe(false);
	});

	test("org: an org user not on any panel sees none of these interviews", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.listMyInterviews(otherToken, {});
		expect(res.status).toBe(200);
		const mine = res.body!.interviews.filter((iv) =>
			scheduledInterviewIds.includes(iv.interview_id)
		);
		expect(mine.length).toBe(0);
	});

	test("org: filter_state=cancelled excludes scheduled interviews", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.listMyInterviews(interviewerToken, {
			filter_state: ["cancelled"],
		});
		expect(res.status).toBe(200);
		const mine = res.body!.interviews.filter((iv) =>
			scheduledInterviewIds.includes(iv.interview_id)
		);
		expect(mine.length).toBe(0);
	});

	test("org: limit=1 paginates with a next key", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const page1 = await api.listMyInterviews(interviewerToken, { limit: 1 });
		expect(page1.status).toBe(200);
		expect(page1.body!.interviews.length).toBe(1);
		expect(page1.body!.next_pagination_key).toBeTruthy();

		const page2 = await api.listMyInterviews(interviewerToken, {
			limit: 1,
			pagination_key: page1.body!.next_pagination_key,
		});
		expect(page2.status).toBe(200);
		expect(page2.body!.interviews.length).toBeGreaterThanOrEqual(1);
		// No overlap between pages.
		expect(page2.body!.interviews[0].interview_id).not.toBe(
			page1.body!.interviews[0].interview_id
		);
	});

	test("org: limit=0 → 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.listMyInterviews(interviewerToken, { limit: 0 });
		expect(res.status).toBe(400);
	});

	test("org: 401 when unauthenticated", async ({ request }) => {
		const res = await request.post("/org/list-my-interviews", { data: {} });
		expect(res.status()).toBe(401);
	});

	// ─── hub/list-my-interviews ──────────────────────────────────────────────

	test("hub: candidate sees their interviews across candidacies, soonest first", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const res = await api.listMyInterviews(hubToken, {});
		expect(res.status).toBe(200);

		const mine = res.body!.interviews.filter((iv) =>
			scheduledInterviewIds.includes(iv.interview_id)
		);
		expect(mine.length).toBe(2);

		const times = mine.map((iv) => new Date(iv.starts_at).getTime());
		expect(times[0]).toBeLessThanOrEqual(times[1]);
		expect(mine[0].opening_title).toBe("My Interviews Opening");
		expect(mine[0].candidacy_id).toBe(candidacyId);
	});

	test("hub: a different candidate sees none of these interviews", async ({
		request,
	}) => {
		const hubApi = new HubAPIClient(request);
		const otherHubEmail = generateTestEmail("my-iv-hub2");
		const otherHub = await createTestHubUserDirect(
			otherHubEmail,
			TEST_PASSWORD,
			"myivhub2"
		);
		try {
			const res = await hubApi.listMyInterviews(otherHub.sessionToken, {});
			expect(res.status).toBe(200);
			const mine = res.body!.interviews.filter((iv) =>
				scheduledInterviewIds.includes(iv.interview_id)
			);
			expect(mine.length).toBe(0);
		} finally {
			await deleteTestHubUser(otherHubEmail);
		}
	});

	test("hub: limit=0 → 400", async ({ request }) => {
		const api = new HubAPIClient(request);
		const res = await api.listMyInterviews(hubToken, { limit: 0 });
		expect(res.status).toBe(400);
	});

	test("hub: 401 when unauthenticated", async ({ request }) => {
		const res = await request.post("/hub/list-my-interviews", { data: {} });
		expect(res.status()).toBe(401);
	});
});
