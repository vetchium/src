import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import {
	createTestHubUserDirect,
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	createTestMarketplaceListingDirect,
	createTestMarketplaceSubscriptionDirect,
	createTestOpeningDirect,
	assignRoleToOrgUser,
	countOrgAuditLogs,
	deleteTestHubUser,
	deleteTestOrgUser,
	deleteTestGlobalOrgDomain,
	generateTestEmail,
	generateTestOrgEmail,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type {
	GetAssignedOpeningResponse,
	ListAgencyRecruitersResponse,
	ListAssignedOpeningsResponse,
	ListClientDefaultRecruitersResponse,
} from "vetchium-specs/org/agency-referrals";

const BASE = "http://localhost:8080";

async function loginOrg(
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

test.describe("Agency Recruiters", () => {
	test.describe.configure({ mode: "serial" });

	const { email: consumerEmail, domain: consumerDomain } =
		generateTestOrgEmail("agrec-consumer");
	const { email: agencyEmail, domain: agencyDomain } =
		generateTestOrgEmail("agrec-agency");
	const recruiterAEmail = `recruiter-a@${agencyDomain}`;
	const recruiterBEmail = `recruiter-b@${agencyDomain}`;
	const candidate1Email = generateTestEmail("agrec-cand1");
	const candidate2Email = generateTestEmail("agrec-cand2");

	let consumerToken: string;
	let agencyToken: string; // lead (superadmin)
	let recruiterAToken: string;
	let recruiterBToken: string;
	let agencyOrgUserId: string; // lead, for audit assertions
	let recruiterAOrgUserId: string;
	let recruiterBOrgUserId: string;
	let opening1Id: string;
	let opening2Id: string;
	let candidate1Handle: string;
	let candidate2Handle: string;

	test.beforeAll(async ({ playwright }) => {
		const request = await playwright.request.newContext({ baseURL: BASE });
		const api = new OrgAPIClient(request);

		const consumer = await createTestOrgAdminDirect(
			consumerEmail,
			TEST_PASSWORD
		);
		consumerToken = await loginOrg(api, consumerEmail, consumerDomain);

		const agency = await createTestOrgAdminDirect(agencyEmail, TEST_PASSWORD);
		agencyOrgUserId = agency.orgUserId;
		agencyToken = await loginOrg(api, agencyEmail, agencyDomain);

		// Two non-lead recruiters in the agency org with the agency-side roles.
		const recruiterA = await createTestOrgUserDirect(
			recruiterAEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId: agency.orgId, domain: agencyDomain }
		);
		recruiterAOrgUserId = recruiterA.orgUserId;
		await assignRoleToOrgUser(recruiterAOrgUserId, "org:refer_candidates");
		await assignRoleToOrgUser(recruiterAOrgUserId, "org:view_agency_referrals");
		recruiterAToken = await loginOrg(api, recruiterAEmail, agencyDomain);

		const recruiterB = await createTestOrgUserDirect(
			recruiterBEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId: agency.orgId, domain: agencyDomain }
		);
		recruiterBOrgUserId = recruiterB.orgUserId;
		await assignRoleToOrgUser(recruiterBOrgUserId, "org:refer_candidates");
		await assignRoleToOrgUser(recruiterBOrgUserId, "org:view_agency_referrals");
		recruiterBToken = await loginOrg(api, recruiterBEmail, agencyDomain);

		// Agency publishes a staffing listing; consumer subscribes.
		const listing = await createTestMarketplaceListingDirect(
			agency.orgId,
			agencyDomain,
			["staffing"],
			"active"
		);
		await createTestMarketplaceSubscriptionDirect(
			consumer.orgId,
			"ind1",
			agency.orgId,
			"ind1",
			listing.listingId
		);

		// Two published openings owned by the consumer.
		const o1 = await createTestOpeningDirect(
			consumer.orgId,
			consumer.orgUserId,
			"Role One"
		);
		opening1Id = o1.openingId;
		const o2 = await createTestOpeningDirect(
			consumer.orgId,
			consumer.orgUserId,
			"Role Two"
		);
		opening2Id = o2.openingId;

		// Consumer assigns the agency to both openings.
		for (const openingId of [opening1Id, opening2Id]) {
			const res = await request.post("/org/assign-opening-agency", {
				headers: { Authorization: `Bearer ${consumerToken}` },
				data: { opening_id: openingId, agency_org_domain: agencyDomain },
			});
			expect(res.status()).toBe(200);
		}

		const c1 = await createTestHubUserDirect(
			candidate1Email,
			TEST_PASSWORD,
			"agrec-cand1"
		);
		candidate1Handle = c1.handle;
		const c2 = await createTestHubUserDirect(
			candidate2Email,
			TEST_PASSWORD,
			"agrec-cand2"
		);
		candidate2Handle = c2.handle;

		await request.dispose();
	});

	test.afterAll(async () => {
		await deleteTestHubUser(candidate1Email).catch(() => {});
		await deleteTestHubUser(candidate2Email).catch(() => {});
		await deleteTestOrgUser(recruiterAEmail).catch(() => {});
		await deleteTestOrgUser(recruiterBEmail).catch(() => {});
		await deleteTestOrgUser(consumerEmail).catch(() => {});
		await deleteTestOrgUser(agencyEmail).catch(() => {});
		await deleteTestGlobalOrgDomain(consumerDomain).catch(() => {});
		await deleteTestGlobalOrgDomain(agencyDomain).catch(() => {});
	});

	test("401 without auth on assign-opening-recruiters", async ({ request }) => {
		const res = await request.post("/org/assign-opening-recruiters", {
			data: {
				opening_id: opening1Id,
				consumer_org_domain: consumerDomain,
				agency_org_user_ids: [recruiterAOrgUserId],
			},
		});
		expect(res.status()).toBe(401);
	});

	test("lead lists agency recruiters", async ({ request }) => {
		const res = await request.post("/org/list-agency-recruiters", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: {},
		});
		expect(res.status()).toBe(200);
		const body = (await res.json()) as ListAgencyRecruitersResponse;
		const emails = body.recruiters.map((r) => r.email);
		expect(emails).toContain(recruiterAEmail);
		expect(emails).toContain(recruiterBEmail);
	});

	test("lead assigns recruiterA to opening1 (200 + audit)", async ({
		request,
	}) => {
		const before = await countOrgAuditLogs(
			agencyOrgUserId,
			"org.assign_opening_recruiters"
		);
		const res = await request.post("/org/assign-opening-recruiters", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: {
				opening_id: opening1Id,
				consumer_org_domain: consumerDomain,
				agency_org_user_ids: [recruiterAOrgUserId],
			},
		});
		expect(res.status()).toBe(200);
		const after = await countOrgAuditLogs(
			agencyOrgUserId,
			"org.assign_opening_recruiters"
		);
		expect(after).toBe(before + 1);
	});

	test("RBAC: recruiterA (no manage role) cannot assign (403)", async ({
		request,
	}) => {
		const res = await request.post("/org/assign-opening-recruiters", {
			headers: { Authorization: `Bearer ${recruiterAToken}` },
			data: {
				opening_id: opening1Id,
				consumer_org_domain: consumerDomain,
				agency_org_user_ids: [recruiterBOrgUserId],
			},
		});
		expect(res.status()).toBe(403);
	});

	test("assigned recruiterA can get opening1 (200)", async ({ request }) => {
		const res = await request.post("/org/get-assigned-opening", {
			headers: { Authorization: `Bearer ${recruiterAToken}` },
			data: { opening_id: opening1Id },
		});
		expect(res.status()).toBe(200);
		const body = (await res.json()) as GetAssignedOpeningResponse;
		expect(body.opening.recruiters_are_default).toBe(false);
		expect(
			body.opening.recruiters.some((r) => r.org_user_id === recruiterAOrgUserId)
		).toBe(true);
	});

	test("unassigned recruiterB cannot get opening1 (403)", async ({
		request,
	}) => {
		const res = await request.post("/org/get-assigned-opening", {
			headers: { Authorization: `Bearer ${recruiterBToken}` },
			data: { opening_id: opening1Id },
		});
		expect(res.status()).toBe(403);
	});

	test("assigned recruiterA refers candidate1 (201)", async ({ request }) => {
		const res = await request.post("/org/refer-candidate", {
			headers: { Authorization: `Bearer ${recruiterAToken}` },
			data: { opening_id: opening1Id, candidate_handle: candidate1Handle },
		});
		expect(res.status()).toBe(201);
	});

	test("unassigned recruiterB cannot refer into opening1 (403)", async ({
		request,
	}) => {
		const res = await request.post("/org/refer-candidate", {
			headers: { Authorization: `Bearer ${recruiterBToken}` },
			data: { opening_id: opening1Id, candidate_handle: candidate2Handle },
		});
		expect(res.status()).toBe(403);
	});

	test("lead can refer candidate2 into opening1 (201)", async ({ request }) => {
		const res = await request.post("/org/refer-candidate", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { opening_id: opening1Id, candidate_handle: candidate2Handle },
		});
		expect(res.status()).toBe(201);
	});

	test("recruiterA sees opening1 but not opening2 (scoping)", async ({
		request,
	}) => {
		const res = await request.post("/org/list-assigned-openings", {
			headers: { Authorization: `Bearer ${recruiterAToken}` },
			data: { limit: 50 },
		});
		expect(res.status()).toBe(200);
		const body = (await res.json()) as ListAssignedOpeningsResponse;
		const ids = body.openings.map((o) => o.opening_id);
		expect(ids).toContain(opening1Id);
		expect(ids).not.toContain(opening2Id);
		// opening1 carries the two referrals just created.
		const o1 = body.openings.find((o) => o.opening_id === opening1Id)!;
		expect(o1.referral_counts.pending).toBeGreaterThanOrEqual(2);
	});

	test("lead sees all openings; client filter narrows", async ({ request }) => {
		const all = await request.post("/org/list-assigned-openings", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { limit: 50 },
		});
		expect(all.status()).toBe(200);
		const allBody = (await all.json()) as ListAssignedOpeningsResponse;
		const ids = allBody.openings.map((o) => o.opening_id);
		expect(ids).toContain(opening1Id);
		expect(ids).toContain(opening2Id);

		const none = await request.post("/org/list-assigned-openings", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { limit: 50, filter_client_domain: "no-such-client.example" },
		});
		expect(none.status()).toBe(200);
		const noneBody = (await none.json()) as ListAssignedOpeningsResponse;
		expect(noneBody.openings.length).toBe(0);
	});

	test("client default grants access to opening2 for recruiterB (200 + audit)", async ({
		request,
	}) => {
		const before = await countOrgAuditLogs(
			agencyOrgUserId,
			"org.set_client_default_recruiters"
		);
		const setRes = await request.post("/org/set-client-default-recruiters", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: {
				consumer_org_domain: consumerDomain,
				agency_org_user_ids: [recruiterBOrgUserId],
			},
		});
		expect(setRes.status()).toBe(200);
		const after = await countOrgAuditLogs(
			agencyOrgUserId,
			"org.set_client_default_recruiters"
		);
		expect(after).toBe(before + 1);

		// opening2 has no explicit recruiter, so the domain default applies.
		const getRes = await request.post("/org/get-assigned-opening", {
			headers: { Authorization: `Bearer ${recruiterBToken}` },
			data: { opening_id: opening2Id },
		});
		expect(getRes.status()).toBe(200);
		const body = (await getRes.json()) as GetAssignedOpeningResponse;
		expect(body.opening.recruiters_are_default).toBe(true);
		expect(
			body.opening.recruiters.some((r) => r.org_user_id === recruiterBOrgUserId)
		).toBe(true);
	});

	test("list-client-default-recruiters returns the default", async ({
		request,
	}) => {
		const res = await request.post("/org/list-client-default-recruiters", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: {},
		});
		expect(res.status()).toBe(200);
		const body = (await res.json()) as ListClientDefaultRecruitersResponse;
		const entry = body.defaults.find(
			(d) => d.consumer_org_domain === consumerDomain
		);
		expect(entry).toBeDefined();
		expect(
			entry!.recruiters.some((r) => r.org_user_id === recruiterBOrgUserId)
		).toBe(true);
	});

	test("removing the default revokes recruiterB access to opening2 (403)", async ({
		request,
	}) => {
		const rm = await request.post("/org/remove-client-default-recruiter", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: {
				consumer_org_domain: consumerDomain,
				agency_org_user_id: recruiterBOrgUserId,
			},
		});
		expect(rm.status()).toBe(200);

		const getRes = await request.post("/org/get-assigned-opening", {
			headers: { Authorization: `Bearer ${recruiterBToken}` },
			data: { opening_id: opening2Id },
		});
		expect(getRes.status()).toBe(403);
	});

	test("removing recruiterA from opening1 revokes access (200 then 403)", async ({
		request,
	}) => {
		const rm = await request.post("/org/remove-opening-recruiter", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { opening_id: opening1Id, agency_org_user_id: recruiterAOrgUserId },
		});
		expect(rm.status()).toBe(200);

		const getRes = await request.post("/org/get-assigned-opening", {
			headers: { Authorization: `Bearer ${recruiterAToken}` },
			data: { opening_id: opening1Id },
		});
		expect(getRes.status()).toBe(403);
	});
});
