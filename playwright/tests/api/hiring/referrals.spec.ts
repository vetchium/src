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
	ListAssignedOpeningsResponse,
	ListAgencyReferralsResponse,
	ListAssignableAgenciesResponse,
} from "vetchium-specs/org/agency-referrals";
import type { ListReferralsReceivedResponse } from "vetchium-specs/hub/referrals";
import type { ListApplicationsResponse } from "vetchium-specs/org/applications";

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

test.describe("Agency Referrals", () => {
	test.describe.configure({ mode: "serial" });

	const { email: consumerEmail, domain: consumerDomain } =
		generateTestOrgEmail("agref-consumer");
	const { email: agencyEmail, domain: agencyDomain } =
		generateTestOrgEmail("agref-agency");
	const candidateEmail = generateTestEmail("agref-cand");
	const noRoleEmail = generateTestEmail("agref-norole");

	let consumerToken: string;
	let agencyToken: string;
	let candidateToken: string;
	let candidateHandle: string;
	let consumerOrgId: string;
	let consumerOrgUserId: string;
	let agencyOrgId: string;
	let openingId: string;
	let openingNumber: number;
	let noRoleEmailAddr: string;

	test.beforeAll(async ({ playwright }) => {
		const request = await playwright.request.newContext({
			baseURL: "http://localhost:8080",
		});
		const api = new OrgAPIClient(request);

		const consumer = await createTestOrgAdminDirect(
			consumerEmail,
			TEST_PASSWORD
		);
		consumerOrgId = consumer.orgId;
		consumerOrgUserId = consumer.orgUserId;
		consumerToken = await loginOrg(api, consumerEmail, consumerDomain);

		const agency = await createTestOrgAdminDirect(agencyEmail, TEST_PASSWORD);
		agencyOrgId = agency.orgId;
		agencyToken = await loginOrg(api, agencyEmail, agencyDomain);

		// Agency publishes a staffing listing; consumer subscribes to it.
		const listing = await createTestMarketplaceListingDirect(
			agencyOrgId,
			agencyDomain,
			["staffing"],
			"active"
		);
		await createTestMarketplaceSubscriptionDirect(
			consumerOrgId,
			"ind1",
			agencyOrgId,
			"ind1",
			listing.listingId
		);

		// Consumer has a published opening.
		const opening = await createTestOpeningDirect(
			consumerOrgId,
			consumerOrgUserId,
			"Agency Role"
		);
		openingId = opening.openingId;
		openingNumber = opening.openingNumber;

		// Candidate hub user.
		const cand = await createTestHubUserDirect(
			candidateEmail,
			TEST_PASSWORD,
			"agref-cand"
		);
		candidateToken = cand.sessionToken;
		candidateHandle = cand.handle;

		// No-role org user inside the consumer org (for RBAC negative).
		const noRole = await createTestOrgUserDirect(
			noRoleEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId: consumerOrgId, domain: consumerDomain }
		);
		noRoleEmailAddr = noRole.email;

		await request.dispose();
	});

	test.afterAll(async () => {
		await deleteTestHubUser(candidateEmail).catch(() => {});
		await deleteTestOrgUser(consumerEmail).catch(() => {});
		await deleteTestOrgUser(agencyEmail).catch(() => {});
		await deleteTestOrgUser(noRoleEmailAddr).catch(() => {});
		await deleteTestGlobalOrgDomain(consumerDomain).catch(() => {});
		await deleteTestGlobalOrgDomain(agencyDomain).catch(() => {});
	});

	test("401 without auth on assign-opening-agency", async ({ request }) => {
		const res = await request.post("/org/assign-opening-agency", {
			data: { opening_id: openingId, agency_org_domain: agencyDomain },
		});
		expect(res.status()).toBe(401);
	});

	test("401 without auth on list-assignable-agencies", async ({ request }) => {
		const res = await request.post("/org/list-assignable-agencies", {
			data: {},
		});
		expect(res.status()).toBe(401);
	});

	test("consumer sees its staffing provider in list-assignable-agencies (200)", async ({
		request,
	}) => {
		const res = await request.post("/org/list-assignable-agencies", {
			headers: { Authorization: `Bearer ${consumerToken}` },
			data: {},
		});
		expect(res.status()).toBe(200);
		const body: ListAssignableAgenciesResponse = await res.json();
		const match = body.agencies.find(
			(a) => a.agency_org_domain === agencyDomain
		);
		expect(match).toBeDefined();
	});

	test("consumer assigns the agency to its published opening (200)", async ({
		request,
	}) => {
		const res = await request.post("/org/assign-opening-agency", {
			headers: { Authorization: `Bearer ${consumerToken}` },
			data: { opening_id: openingId, agency_org_domain: agencyDomain },
		});
		expect(res.status()).toBe(200);
	});

	test("agency sees the opening in list-assigned-openings (200)", async ({
		request,
	}) => {
		const res = await request.post("/org/list-assigned-openings", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { limit: 20 },
		});
		expect(res.status()).toBe(200);
		const body = (await res.json()) as ListAssignedOpeningsResponse;
		expect(body.openings.some((o) => o.opening_id === openingId)).toBe(true);
	});

	test("agency refers the candidate (201)", async ({ request }) => {
		const res = await request.post("/org/refer-candidate", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { opening_id: openingId, candidate_handle: candidateHandle },
		});
		expect(res.status()).toBe(201);
		const body = await res.json();
		expect(body.referral_id).toBeTruthy();
	});

	test("duplicate pending referral from same agency (409)", async ({
		request,
	}) => {
		const res = await request.post("/org/refer-candidate", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { opening_id: openingId, candidate_handle: candidateHandle },
		});
		expect(res.status()).toBe(409);
	});

	test("refer unknown handle (404)", async ({ request }) => {
		const res = await request.post("/org/refer-candidate", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { opening_id: openingId, candidate_handle: "nonexistent-xyz-123" },
		});
		expect(res.status()).toBe(404);
	});

	test("candidate inbox shows the referral with real fields (200)", async ({
		request,
	}) => {
		const res = await request.post("/hub/list-referrals-received", {
			headers: { Authorization: `Bearer ${candidateToken}` },
			data: { limit: 20 },
		});
		expect(res.status()).toBe(200);
		const body = (await res.json()) as ListReferralsReceivedResponse;
		const r = body.referrals.find((x) => x.agency_org_domain === agencyDomain);
		expect(r).toBeDefined();
		expect(r!.consumer_org_domain).toBe(consumerDomain);
		expect(r!.opening_number).toBe(openingNumber);
		expect(r!.opening_title).toBe("Agency Role");
		expect(r!.state).toBe("pending");
	});

	test("candidate applies via the agency; attribution recorded (201 + badge)", async ({
		request,
	}) => {
		const applyRes = await request.post("/hub/apply-for-opening", {
			headers: { Authorization: `Bearer ${candidateToken}` },
			multipart: {
				org_domain: consumerDomain,
				opening_number: String(openingNumber),
				cover_letter: "I am very interested in this role. ".repeat(5),
				apply_via: agencyDomain,
				resume: {
					name: "resume.pdf",
					mimeType: "application/pdf",
					buffer: Buffer.from(
						"%PDF-1.4 test resume content for agency referral"
					),
				},
			},
		});
		expect(applyRes.status()).toBe(201);

		// Consumer sees the application attributed to the agency.
		const listRes = await request.post("/org/list-applications", {
			headers: { Authorization: `Bearer ${consumerToken}` },
			data: { opening_id: openingId, limit: 20 },
		});
		expect(listRes.status()).toBe(200);
		const body = (await listRes.json()) as ListApplicationsResponse;
		expect(body.applications.length).toBeGreaterThan(0);
		expect(body.applications[0].referring_agency_domain).toBe(agencyDomain);

		// And it is filterable by that agency.
		const filterRes = await request.post("/org/list-applications", {
			headers: { Authorization: `Bearer ${consumerToken}` },
			data: { opening_id: openingId, filter_agency: agencyDomain, limit: 20 },
		});
		expect(filterRes.status()).toBe(200);
		const filtered = (await filterRes.json()) as ListApplicationsResponse;
		expect(filtered.applications.length).toBe(1);
	});

	test("agency's referral is now accepted_applied (200)", async ({
		request,
	}) => {
		const res = await request.post("/org/list-agency-referrals", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { limit: 20 },
		});
		expect(res.status()).toBe(200);
		const body = (await res.json()) as ListAgencyReferralsResponse;
		const r = body.referrals.find((x) => x.opening_number === openingNumber);
		expect(r).toBeDefined();
		expect(r!.state).toBe("accepted_applied");
	});

	test("RBAC: org user without the role cannot assign (403)", async ({
		playwright,
	}) => {
		const request = await playwright.request.newContext({
			baseURL: "http://localhost:8080",
		});
		try {
			const api = new OrgAPIClient(request);
			const token = await loginOrg(api, noRoleEmailAddr, consumerDomain);
			const res = await request.post("/org/assign-opening-agency", {
				headers: { Authorization: `Bearer ${token}` },
				data: { opening_id: openingId, agency_org_domain: agencyDomain },
			});
			expect(res.status()).toBe(403);

			// Same role guards the assign-agency picker source.
			const pickerRes = await request.post("/org/list-assignable-agencies", {
				headers: { Authorization: `Bearer ${token}` },
				data: {},
			});
			expect(pickerRes.status()).toBe(403);
		} finally {
			await request.dispose();
		}
	});
});
