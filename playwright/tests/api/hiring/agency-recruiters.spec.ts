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
	getLatestOrgAuditEventData,
	updateTestOrgUserStatus,
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
	AgencyReferralSummaryResponse,
	GetAssignedOpeningResponse,
	ListAgencyRecruitersResponse,
	ListAssignedOpeningsResponse,
	ListClientDefaultAssigneesResponse,
} from "vetchium-specs/org/agency-referrals";

const BASE = "http://localhost:8080";
const BOGUS_UUID = "00000000-0000-0000-0000-000000000000";

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

test.describe("Agency single-assignee model", () => {
	test.describe.configure({ mode: "serial" });

	const { email: consumerEmail, domain: consumerDomain } =
		generateTestOrgEmail("agasg-consumer");
	const { email: agencyEmail, domain: agencyDomain } =
		generateTestOrgEmail("agasg-agency");
	const recruiterAEmail = `recruiter-a@${agencyDomain}`;
	const recruiterBEmail = `recruiter-b@${agencyDomain}`;
	const managerEmail = `manager@${agencyDomain}`;
	const noRoleEmail = `norole@${agencyDomain}`;
	const candidate1Email = generateTestEmail("agasg-cand1");
	const candidate2Email = generateTestEmail("agasg-cand2");

	let consumerToken: string;
	let agencyToken: string; // lead (superadmin)
	let recruiterAToken: string;
	let recruiterBToken: string;
	let managerToken: string; // non-superadmin lead (manage_agency_recruiters)
	let noRoleToken: string;
	let agencyOrgUserId: string; // first active superadmin
	let recruiterAOrgUserId: string;
	let recruiterBOrgUserId: string;
	let managerOrgUserId: string;
	let opening1Id: string;
	let opening2Id: string;
	let opening3Id: string;
	let consumerOrgId: string;
	let consumerOrgUserId: string;
	let candidate1Handle: string;
	let candidate2Handle: string;

	async function assignAgency(token: string, openingId: string) {
		const res = await fetch(`${BASE}/org/assign-opening-agency`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				opening_id: openingId,
				agency_org_domain: agencyDomain,
			}),
		});
		return res.status;
	}

	test.beforeAll(async ({ playwright }) => {
		const request = await playwright.request.newContext({ baseURL: BASE });
		const api = new OrgAPIClient(request);

		const consumer = await createTestOrgAdminDirect(
			consumerEmail,
			TEST_PASSWORD
		);
		consumerOrgId = consumer.orgId;
		consumerOrgUserId = consumer.orgUserId;
		consumerToken = await loginOrg(api, consumerEmail, consumerDomain);

		const agency = await createTestOrgAdminDirect(agencyEmail, TEST_PASSWORD);
		agencyOrgUserId = agency.orgUserId;
		agencyToken = await loginOrg(api, agencyEmail, agencyDomain);

		// Two non-lead recruiters (refer + view only).
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

		// Non-superadmin lead (manage_agency_recruiters) for RBAC positive tests.
		const manager = await createTestOrgUserDirect(
			managerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId: agency.orgId, domain: agencyDomain }
		);
		managerOrgUserId = manager.orgUserId;
		await assignRoleToOrgUser(managerOrgUserId, "org:manage_agency_recruiters");
		await assignRoleToOrgUser(managerOrgUserId, "org:view_agency_referrals");
		managerToken = await loginOrg(api, managerEmail, agencyDomain);

		// Authenticated agency user with no agency-referral roles (RBAC negative).
		await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
			orgId: agency.orgId,
			domain: agencyDomain,
		});
		noRoleToken = await loginOrg(api, noRoleEmail, agencyDomain);

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

		// Consumer assigns the agency to both openings (auto-assignee resolves).
		expect(await assignAgency(consumerToken, opening1Id)).toBe(200);
		expect(await assignAgency(consumerToken, opening2Id)).toBe(200);

		const c1 = await createTestHubUserDirect(
			candidate1Email,
			TEST_PASSWORD,
			"agasg-cand1"
		);
		candidate1Handle = c1.handle;
		const c2 = await createTestHubUserDirect(
			candidate2Email,
			TEST_PASSWORD,
			"agasg-cand2"
		);
		candidate2Handle = c2.handle;

		await request.dispose();
	});

	test.afterAll(async () => {
		await deleteTestHubUser(candidate1Email).catch(() => {});
		await deleteTestHubUser(candidate2Email).catch(() => {});
		await deleteTestOrgUser(recruiterAEmail).catch(() => {});
		await deleteTestOrgUser(recruiterBEmail).catch(() => {});
		await deleteTestOrgUser(managerEmail).catch(() => {});
		await deleteTestOrgUser(noRoleEmail).catch(() => {});
		await deleteTestOrgUser(consumerEmail).catch(() => {});
		await deleteTestOrgUser(agencyEmail).catch(() => {});
		await deleteTestGlobalOrgDomain(consumerDomain).catch(() => {});
		await deleteTestGlobalOrgDomain(agencyDomain).catch(() => {});
	});

	test("401 without auth on reassign-opening", async ({ request }) => {
		const res = await request.post("/org/reassign-opening", {
			data: { opening_id: opening1Id, agency_org_user_id: recruiterAOrgUserId },
		});
		expect(res.status()).toBe(401);
	});

	test("lead lists active agency recruiters", async ({ request }) => {
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

	test("no default → auto-assigned to first active superadmin", async ({
		request,
	}) => {
		const res = await request.post("/org/get-assigned-opening", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { opening_id: opening1Id },
		});
		expect(res.status()).toBe(200);
		const body = (await res.json()) as GetAssignedOpeningResponse;
		expect(body.opening.assignee?.org_user_id).toBe(agencyOrgUserId);
		expect(body.opening.needs_reassignment).toBe(false);
	});

	test("lead reassigns opening1 to recruiterA (200 + audit)", async ({
		request,
	}) => {
		const before = await countOrgAuditLogs(
			agencyOrgUserId,
			"org.reassign_opening"
		);
		const res = await request.post("/org/reassign-opening", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { opening_id: opening1Id, agency_org_user_id: recruiterAOrgUserId },
		});
		expect(res.status()).toBe(200);
		const after = await countOrgAuditLogs(
			agencyOrgUserId,
			"org.reassign_opening"
		);
		expect(after).toBe(before + 1);
	});

	test("RBAC negative: no-role user cannot reassign (403)", async ({
		request,
	}) => {
		const res = await request.post("/org/reassign-opening", {
			headers: { Authorization: `Bearer ${noRoleToken}` },
			data: { opening_id: opening1Id, agency_org_user_id: recruiterBOrgUserId },
		});
		expect(res.status()).toBe(403);
	});

	test("RBAC negative: non-lead recruiter cannot reassign (403)", async ({
		request,
	}) => {
		const res = await request.post("/org/reassign-opening", {
			headers: { Authorization: `Bearer ${recruiterAToken}` },
			data: { opening_id: opening1Id, agency_org_user_id: recruiterBOrgUserId },
		});
		expect(res.status()).toBe(403);
	});

	test("RBAC positive: manager (manage role, non-superadmin) reassigns (200)", async ({
		request,
	}) => {
		const res = await request.post("/org/reassign-opening", {
			headers: { Authorization: `Bearer ${managerToken}` },
			data: { opening_id: opening1Id, agency_org_user_id: recruiterAOrgUserId },
		});
		expect(res.status()).toBe(200);
	});

	test("reassign to a non-member user → 422", async ({ request }) => {
		const res = await request.post("/org/reassign-opening", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { opening_id: opening1Id, agency_org_user_id: BOGUS_UUID },
		});
		expect(res.status()).toBe(422);
	});

	test("reassign on an unassigned opening → 404", async ({ request }) => {
		const res = await request.post("/org/reassign-opening", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { opening_id: BOGUS_UUID, agency_org_user_id: recruiterAOrgUserId },
		});
		expect(res.status()).toBe(404);
	});

	test("assignee recruiterA can get opening1 (200)", async ({ request }) => {
		const res = await request.post("/org/get-assigned-opening", {
			headers: { Authorization: `Bearer ${recruiterAToken}` },
			data: { opening_id: opening1Id },
		});
		expect(res.status()).toBe(200);
		const body = (await res.json()) as GetAssignedOpeningResponse;
		expect(body.opening.assignee?.org_user_id).toBe(recruiterAOrgUserId);
		expect(body.opening.needs_reassignment).toBe(false);
	});

	test("non-assignee recruiterB cannot get opening1 (403)", async ({
		request,
	}) => {
		const res = await request.post("/org/get-assigned-opening", {
			headers: { Authorization: `Bearer ${recruiterBToken}` },
			data: { opening_id: opening1Id },
		});
		expect(res.status()).toBe(403);
	});

	test("assignee recruiterA refers candidate1 (201)", async ({ request }) => {
		const res = await request.post("/org/refer-candidate", {
			headers: { Authorization: `Bearer ${recruiterAToken}` },
			data: { opening_id: opening1Id, candidate_handle: candidate1Handle },
		});
		expect(res.status()).toBe(201);
	});

	test("non-assignee recruiterB cannot refer into opening1 (403)", async ({
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

	test("recruiterA sees only opening1 (assignee scoping)", async ({
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
		const o1 = body.openings.find((o) => o.opening_id === opening1Id)!;
		expect(o1.assignee?.org_user_id).toBe(recruiterAOrgUserId);
		expect(o1.referral_counts.pending).toBeGreaterThanOrEqual(2);
	});

	test("lead sees all openings; client filter narrows", async ({ request }) => {
		const all = await request.post("/org/list-assigned-openings", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { limit: 50 },
		});
		expect(all.status()).toBe(200);
		const ids = (
			(await all.json()) as ListAssignedOpeningsResponse
		).openings.map((o) => o.opening_id);
		expect(ids).toContain(opening1Id);
		expect(ids).toContain(opening2Id);

		const none = await request.post("/org/list-assigned-openings", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { limit: 50, filter_client_domain: "no-such-client.example" },
		});
		expect(none.status()).toBe(200);
		expect(
			((await none.json()) as ListAssignedOpeningsResponse).openings.length
		).toBe(0);
	});

	test("set default assignee (200 + audit) and list it", async ({
		request,
	}) => {
		const before = await countOrgAuditLogs(
			agencyOrgUserId,
			"org.set_client_default_assignee"
		);
		const setRes = await request.post("/org/set-client-default-assignee", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: {
				consumer_org_domain: consumerDomain,
				agency_org_user_id: recruiterBOrgUserId,
			},
		});
		expect(setRes.status()).toBe(200);
		const after = await countOrgAuditLogs(
			agencyOrgUserId,
			"org.set_client_default_assignee"
		);
		expect(after).toBe(before + 1);

		const listRes = await request.post("/org/list-client-default-assignees", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: {},
		});
		expect(listRes.status()).toBe(200);
		const body = (await listRes.json()) as ListClientDefaultAssigneesResponse;
		const entry = body.defaults.find(
			(d) => d.consumer_org_domain === consumerDomain
		);
		expect(entry?.assignee.org_user_id).toBe(recruiterBOrgUserId);
	});

	test("new assignment uses the default; existing assignments are untouched", async ({
		request,
	}) => {
		const o3 = await createTestOpeningDirect(
			consumerOrgId,
			consumerOrgUserId,
			"Role Three"
		);
		opening3Id = o3.openingId;
		expect(await assignAgency(consumerToken, opening3Id)).toBe(200);

		// opening3 → the configured default (recruiterB).
		const g3 = await request.post("/org/get-assigned-opening", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { opening_id: opening3Id },
		});
		expect(g3.status()).toBe(200);
		expect(
			((await g3.json()) as GetAssignedOpeningResponse).opening.assignee
				?.org_user_id
		).toBe(recruiterBOrgUserId);

		// Immutability: opening1 stays with recruiterA, opening2 stays with the lead.
		const g1 = await request.post("/org/get-assigned-opening", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { opening_id: opening1Id },
		});
		expect(
			((await g1.json()) as GetAssignedOpeningResponse).opening.assignee
				?.org_user_id
		).toBe(recruiterAOrgUserId);
		const g2 = await request.post("/org/get-assigned-opening", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { opening_id: opening2Id },
		});
		expect(
			((await g2.json()) as GetAssignedOpeningResponse).opening.assignee
				?.org_user_id
		).toBe(agencyOrgUserId);
	});

	test("set default to a non-member user → 422", async ({ request }) => {
		const res = await request.post("/org/set-client-default-assignee", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: {
				consumer_org_domain: consumerDomain,
				agency_org_user_id: BOGUS_UUID,
			},
		});
		expect(res.status()).toBe(422);
	});

	test("disabling the assignee surfaces needs-reassignment", async ({
		request,
	}) => {
		// recruiterB is the assignee of opening3.
		await updateTestOrgUserStatus(recruiterBEmail, "disabled");

		const summary = await request.post("/org/get-agency-referral-summary", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: {},
		});
		expect(summary.status()).toBe(200);
		const sBody = (await summary.json()) as AgencyReferralSummaryResponse;
		expect(sBody.needs_reassignment_count).toBeGreaterThanOrEqual(1);

		const list = await request.post("/org/list-assigned-openings", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { limit: 50, filter_assignee: "needs_reassignment" },
		});
		expect(list.status()).toBe(200);
		const o3 = (
			(await list.json()) as ListAssignedOpeningsResponse
		).openings.find((o) => o.opening_id === opening3Id);
		expect(o3).toBeDefined();
		expect(o3!.needs_reassignment).toBe(true);
		expect(o3!.assignee?.org_user_id).toBe(recruiterBOrgUserId);

		// Reassigning to an active user clears it.
		const fix = await request.post("/org/reassign-opening", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { opening_id: opening3Id, agency_org_user_id: managerOrgUserId },
		});
		expect(fix.status()).toBe(200);

		await updateTestOrgUserStatus(recruiterBEmail, "active");
	});

	test("clear default assignee (200 + audit), then list is empty", async ({
		request,
	}) => {
		const before = await countOrgAuditLogs(
			agencyOrgUserId,
			"org.clear_client_default_assignee"
		);
		const res = await request.post("/org/clear-client-default-assignee", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { consumer_org_domain: consumerDomain },
		});
		expect(res.status()).toBe(200);
		const after = await countOrgAuditLogs(
			agencyOrgUserId,
			"org.clear_client_default_assignee"
		);
		expect(after).toBe(before + 1);

		const listRes = await request.post("/org/list-client-default-assignees", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: {},
		});
		const body = (await listRes.json()) as ListClientDefaultAssigneesResponse;
		expect(
			body.defaults.find((d) => d.consumer_org_domain === consumerDomain)
		).toBeUndefined();
	});

	test("clear with no default configured → 404", async ({ request }) => {
		const res = await request.post("/org/clear-client-default-assignee", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { consumer_org_domain: consumerDomain },
		});
		expect(res.status()).toBe(404);
	});

	test.describe("RBAC ± on the new endpoints", () => {
		test("set-client-default-assignee: no-role → 403, manager → 200", async ({
			request,
		}) => {
			const denied = await request.post("/org/set-client-default-assignee", {
				headers: { Authorization: `Bearer ${noRoleToken}` },
				data: {
					consumer_org_domain: consumerDomain,
					agency_org_user_id: recruiterAOrgUserId,
				},
			});
			expect(denied.status()).toBe(403);

			const ok = await request.post("/org/set-client-default-assignee", {
				headers: { Authorization: `Bearer ${managerToken}` },
				data: {
					consumer_org_domain: consumerDomain,
					agency_org_user_id: recruiterAOrgUserId,
				},
			});
			expect(ok.status()).toBe(200);
		});

		test("clear-client-default-assignee: no-role → 403, manager → 200", async ({
			request,
		}) => {
			const denied = await request.post("/org/clear-client-default-assignee", {
				headers: { Authorization: `Bearer ${noRoleToken}` },
				data: { consumer_org_domain: consumerDomain },
			});
			expect(denied.status()).toBe(403);

			const ok = await request.post("/org/clear-client-default-assignee", {
				headers: { Authorization: `Bearer ${managerToken}` },
				data: { consumer_org_domain: consumerDomain },
			});
			expect(ok.status()).toBe(200);
		});

		test("get-agency-referral-summary: no-role → 403, recruiter (view) → 200", async ({
			request,
		}) => {
			const denied = await request.post("/org/get-agency-referral-summary", {
				headers: { Authorization: `Bearer ${noRoleToken}` },
				data: {},
			});
			expect(denied.status()).toBe(403);

			const ok = await request.post("/org/get-agency-referral-summary", {
				headers: { Authorization: `Bearer ${recruiterAToken}` },
				data: {},
			});
			expect(ok.status()).toBe(200);
		});
	});

	test.describe("Validation, auth, and audit integrity", () => {
		test("400 on missing required fields", async ({ request }) => {
			const reassign = await request.post("/org/reassign-opening", {
				headers: { Authorization: `Bearer ${agencyToken}` },
				data: { opening_id: opening1Id }, // no agency_org_user_id
			});
			expect(reassign.status()).toBe(400);

			const setDefault = await request.post(
				"/org/set-client-default-assignee",
				{
					headers: { Authorization: `Bearer ${agencyToken}` },
					data: { consumer_org_domain: consumerDomain }, // no agency_org_user_id
				}
			);
			expect(setDefault.status()).toBe(400);

			const clear = await request.post("/org/clear-client-default-assignee", {
				headers: { Authorization: `Bearer ${agencyToken}` },
				data: {}, // no consumer_org_domain
			});
			expect(clear.status()).toBe(400);
		});

		test("401 without auth on every new endpoint", async ({ request }) => {
			for (const [path, data] of [
				[
					"/org/set-client-default-assignee",
					{
						consumer_org_domain: consumerDomain,
						agency_org_user_id: recruiterAOrgUserId,
					},
				],
				[
					"/org/clear-client-default-assignee",
					{
						consumer_org_domain: consumerDomain,
					},
				],
				["/org/list-client-default-assignees", {}],
				["/org/get-agency-referral-summary", {}],
			] as const) {
				const res = await request.post(path, { data });
				expect(res.status(), `${path} should be 401`).toBe(401);
			}
		});

		test("reassign audit payload has the right fields and no raw email", async ({
			request,
		}) => {
			const res = await request.post("/org/reassign-opening", {
				headers: { Authorization: `Bearer ${agencyToken}` },
				data: {
					opening_id: opening1Id,
					agency_org_user_id: recruiterAOrgUserId,
				},
			});
			expect(res.status()).toBe(200);

			const data = await getLatestOrgAuditEventData(
				agencyOrgUserId,
				"org.reassign_opening"
			);
			expect(data).not.toBeNull();
			expect(data!.opening_id).toBe(opening1Id);
			expect(data!.agency_org_user_id).toBe(recruiterAOrgUserId);
			// No field may contain a raw email address (CLAUDE.md: hashes only).
			expect(JSON.stringify(data)).not.toContain("@");
		});

		test("set-default audit payload stores the domain, not a raw email", async ({
			request,
		}) => {
			const res = await request.post("/org/set-client-default-assignee", {
				headers: { Authorization: `Bearer ${agencyToken}` },
				data: {
					consumer_org_domain: consumerDomain,
					agency_org_user_id: recruiterAOrgUserId,
				},
			});
			expect(res.status()).toBe(200);

			const data = await getLatestOrgAuditEventData(
				agencyOrgUserId,
				"org.set_client_default_assignee"
			);
			expect(data).not.toBeNull();
			expect(data!.consumer_org_domain).toBe(consumerDomain);
			expect(JSON.stringify(data)).not.toContain("@");
		});

		test("no audit row is written when reassign fails (422)", async ({
			request,
		}) => {
			const before = await countOrgAuditLogs(
				agencyOrgUserId,
				"org.reassign_opening"
			);
			const res = await request.post("/org/reassign-opening", {
				headers: { Authorization: `Bearer ${agencyToken}` },
				data: { opening_id: opening1Id, agency_org_user_id: BOGUS_UUID },
			});
			expect(res.status()).toBe(422);
			const after = await countOrgAuditLogs(
				agencyOrgUserId,
				"org.reassign_opening"
			);
			expect(after).toBe(before);
		});

		test("no audit row when set-default fails (422) or clear fails (404)", async ({
			request,
		}) => {
			const setBefore = await countOrgAuditLogs(
				agencyOrgUserId,
				"org.set_client_default_assignee"
			);
			const setRes = await request.post("/org/set-client-default-assignee", {
				headers: { Authorization: `Bearer ${agencyToken}` },
				data: {
					consumer_org_domain: consumerDomain,
					agency_org_user_id: BOGUS_UUID,
				},
			});
			expect(setRes.status()).toBe(422);
			expect(
				await countOrgAuditLogs(
					agencyOrgUserId,
					"org.set_client_default_assignee"
				)
			).toBe(setBefore);

			const clearBefore = await countOrgAuditLogs(
				agencyOrgUserId,
				"org.clear_client_default_assignee"
			);
			const clearRes = await request.post(
				"/org/clear-client-default-assignee",
				{
					headers: { Authorization: `Bearer ${agencyToken}` },
					data: { consumer_org_domain: "no-such-client-domain.example" },
				}
			);
			expect(clearRes.status()).toBe(404);
			expect(
				await countOrgAuditLogs(
					agencyOrgUserId,
					"org.clear_client_default_assignee"
				)
			).toBe(clearBefore);
		});

		test("assign + remove agency: audit payloads and assignee lifecycle", async ({
			request,
		}) => {
			const o4 = await createTestOpeningDirect(
				consumerOrgId,
				consumerOrgUserId,
				"Role Four"
			);

			// Assign — consumer-side audit (actor = consumer user, consumer region).
			const assignBefore = await countOrgAuditLogs(
				consumerOrgUserId,
				"org.assign_opening_agency"
			);
			const aRes = await request.post("/org/assign-opening-agency", {
				headers: { Authorization: `Bearer ${consumerToken}` },
				data: { opening_id: o4.openingId, agency_org_domain: agencyDomain },
			});
			expect(aRes.status()).toBe(200);
			expect(
				await countOrgAuditLogs(consumerOrgUserId, "org.assign_opening_agency")
			).toBe(assignBefore + 1);
			const aData = await getLatestOrgAuditEventData(
				consumerOrgUserId,
				"org.assign_opening_agency"
			);
			expect(aData!.opening_id).toBe(o4.openingId);
			expect(aData!.agency_org_id).toBeTruthy();
			expect(JSON.stringify(aData)).not.toContain("@");

			// The agency now has an assignee for it (auto-assigned, active).
			const got = await request.post("/org/get-assigned-opening", {
				headers: { Authorization: `Bearer ${agencyToken}` },
				data: { opening_id: o4.openingId },
			});
			expect(got.status()).toBe(200);
			const gBody = (await got.json()) as GetAssignedOpeningResponse;
			expect(gBody.opening.assignee).toBeTruthy();
			expect(gBody.opening.needs_reassignment).toBe(false);

			// Remove — consumer-side audit + assignee-row cleanup.
			const removeBefore = await countOrgAuditLogs(
				consumerOrgUserId,
				"org.remove_opening_agency"
			);
			const rRes = await request.post("/org/remove-opening-agency", {
				headers: { Authorization: `Bearer ${consumerToken}` },
				data: { opening_id: o4.openingId, agency_org_domain: agencyDomain },
			});
			expect(rRes.status()).toBe(200);
			expect(
				await countOrgAuditLogs(consumerOrgUserId, "org.remove_opening_agency")
			).toBe(removeBefore + 1);
			const rData = await getLatestOrgAuditEventData(
				consumerOrgUserId,
				"org.remove_opening_agency"
			);
			expect(rData!.opening_id).toBe(o4.openingId);
			expect(JSON.stringify(rData)).not.toContain("@");

			// The opening has left the agency's workspace (assignee row deleted).
			const list = await request.post("/org/list-assigned-openings", {
				headers: { Authorization: `Bearer ${agencyToken}` },
				data: { limit: 100 },
			});
			const ids = (
				(await list.json()) as ListAssignedOpeningsResponse
			).openings.map((o) => o.opening_id);
			expect(ids).not.toContain(o4.openingId);
		});

		test("no audit row when assign fails (404 unknown agency)", async ({
			request,
		}) => {
			const before = await countOrgAuditLogs(
				consumerOrgUserId,
				"org.assign_opening_agency"
			);
			const res = await request.post("/org/assign-opening-agency", {
				headers: { Authorization: `Bearer ${consumerToken}` },
				data: {
					opening_id: opening1Id,
					agency_org_domain: "no-such-agency-domain.example",
				},
			});
			expect(res.status()).toBe(404);
			expect(
				await countOrgAuditLogs(consumerOrgUserId, "org.assign_opening_agency")
			).toBe(before);
		});
	});
});
