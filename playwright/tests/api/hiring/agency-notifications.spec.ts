import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	getTfaCodeFromEmail,
	waitForEmail,
	searchEmails,
	deleteEmailsFor,
} from "../../../lib/mailpit";
import {
	createTestHubUserDirect,
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	createTestMarketplaceListingDirect,
	createTestMarketplaceSubscriptionDirect,
	createTestOpeningDirect,
	assignRoleToOrgUser,
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
import type { ListAgencyReferralsResponse } from "vetchium-specs/org/agency-referrals";

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

// Multipart apply helper mirroring /hub/apply-for-opening usage.
async function applyForOpening(
	request: import("@playwright/test").APIRequestContext,
	candidateToken: string,
	orgDomain: string,
	openingNumber: number,
	opts: { applyVia: string; directAffirm?: boolean }
) {
	return request.post("/hub/apply-for-opening", {
		headers: { Authorization: `Bearer ${candidateToken}` },
		multipart: {
			org_domain: orgDomain,
			opening_number: String(openingNumber),
			cover_letter: "I am very interested in this role. ".repeat(5),
			apply_via: opts.applyVia,
			...(opts.directAffirm ? { direct_no_agency_affirmation: "true" } : {}),
			resume: {
				name: "resume.pdf",
				mimeType: "application/pdf",
				buffer: Buffer.from("%PDF-1.4 test resume content"),
			},
		},
	});
}

// ============================================================================
// Item 7 — referral workflow email triggers
// ============================================================================

test.describe("Agency referral email notifications", () => {
	test.describe.configure({ mode: "serial" });

	const { email: con1Email, domain: con1Domain } =
		generateTestOrgEmail("agnot-con1");
	const { email: con2Email, domain: con2Domain } =
		generateTestOrgEmail("agnot-con2");
	const { email: agencyEmail, domain: agencyDomain } =
		generateTestOrgEmail("agnot-agency");
	const recruiterEmail = `recruiter@${agencyDomain}`;
	const candidateEmail = generateTestEmail("agnot-cand");

	let con1Token: string;
	let con2Token: string;
	let agencyToken: string;
	let candidateToken: string;
	let candidateHandle: string;
	let recruiterOrgUserId: string;
	let opening1Id: string;
	let opening1Number: number;
	let opening2Id: string;
	let opening2Number: number;

	test.beforeAll(async ({ playwright }) => {
		const request = await playwright.request.newContext({ baseURL: BASE });
		const api = new OrgAPIClient(request);

		const con1 = await createTestOrgAdminDirect(con1Email, TEST_PASSWORD);
		con1Token = await loginOrg(api, con1Email, con1Domain);
		const con2 = await createTestOrgAdminDirect(con2Email, TEST_PASSWORD);
		con2Token = await loginOrg(api, con2Email, con2Domain);

		const agency = await createTestOrgAdminDirect(agencyEmail, TEST_PASSWORD);
		agencyToken = await loginOrg(api, agencyEmail, agencyDomain);

		const recruiter = await createTestOrgUserDirect(
			recruiterEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId: agency.orgId, domain: agencyDomain }
		);
		recruiterOrgUserId = recruiter.orgUserId;
		await assignRoleToOrgUser(recruiterOrgUserId, "org:refer_candidates");
		await assignRoleToOrgUser(recruiterOrgUserId, "org:view_agency_referrals");

		// Agency staffing listing; both consumers subscribe.
		const listing = await createTestMarketplaceListingDirect(
			agency.orgId,
			agencyDomain,
			["staffing"],
			"active"
		);
		await createTestMarketplaceSubscriptionDirect(
			con1.orgId,
			"ind1",
			agency.orgId,
			"ind1",
			listing.listingId
		);
		await createTestMarketplaceSubscriptionDirect(
			con2.orgId,
			"ind1",
			agency.orgId,
			"ind1",
			listing.listingId
		);

		const o1 = await createTestOpeningDirect(
			con1.orgId,
			con1.orgUserId,
			"Role One"
		);
		opening1Id = o1.openingId;
		opening1Number = o1.openingNumber;
		const o2 = await createTestOpeningDirect(
			con2.orgId,
			con2.orgUserId,
			"Role Two"
		);
		opening2Id = o2.openingId;
		opening2Number = o2.openingNumber;

		const cand = await createTestHubUserDirect(
			candidateEmail,
			TEST_PASSWORD,
			"agnot-cand"
		);
		candidateToken = cand.sessionToken;
		candidateHandle = cand.handle;

		await request.dispose();
	});

	test.afterAll(async () => {
		await deleteTestHubUser(candidateEmail).catch(() => {});
		await deleteTestOrgUser(recruiterEmail).catch(() => {});
		await deleteTestOrgUser(con1Email).catch(() => {});
		await deleteTestOrgUser(con2Email).catch(() => {});
		await deleteTestOrgUser(agencyEmail).catch(() => {});
		await deleteTestGlobalOrgDomain(con1Domain).catch(() => {});
		await deleteTestGlobalOrgDomain(con2Domain).catch(() => {});
		await deleteTestGlobalOrgDomain(agencyDomain).catch(() => {});
	});

	test("agency assigned to an opening (no default recruiter) emails the agency lead", async ({
		request,
	}) => {
		await deleteEmailsFor(agencyEmail);
		const res = await request.post("/org/assign-opening-agency", {
			headers: { Authorization: `Bearer ${con2Token}` },
			data: { opening_id: opening2Id, agency_org_domain: agencyDomain },
		});
		expect(res.status()).toBe(200);

		const msg = await waitForEmail(agencyEmail, {}, /New opening assigned/i);
		expect(msg.Subject).toContain(con2Domain);
	});

	test("agency assigned to an opening (with default assignee) emails that assignee", async ({
		request,
	}) => {
		// Agency lead sets the default assignee for con1's domain; the next opening
		// assigned from that client is auto-assigned to them.
		const setRes = await request.post("/org/set-client-default-assignee", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: {
				consumer_org_domain: con1Domain,
				agency_org_user_id: recruiterOrgUserId,
			},
		});
		expect(setRes.status()).toBe(200);

		await deleteEmailsFor(recruiterEmail);
		const res = await request.post("/org/assign-opening-agency", {
			headers: { Authorization: `Bearer ${con1Token}` },
			data: { opening_id: opening1Id, agency_org_domain: agencyDomain },
		});
		expect(res.status()).toBe(200);

		const msg = await waitForEmail(
			recruiterEmail,
			{},
			/assigned as recruiter/i
		);
		expect(msg.Subject).toMatch(/assigned as recruiter/i);
	});

	test("reassigning an opening notifies the new assignee", async ({
		request,
	}) => {
		await deleteEmailsFor(recruiterEmail);
		const res = await request.post("/org/reassign-opening", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: {
				opening_id: opening1Id,
				agency_org_user_id: recruiterOrgUserId,
			},
		});
		expect(res.status()).toBe(200);

		const msg = await waitForEmail(
			recruiterEmail,
			{},
			/assigned as recruiter/i
		);
		expect(msg.Subject).toMatch(/assigned as recruiter/i);
	});

	test("referred candidate applying notifies the referring recruiter", async ({
		request,
	}) => {
		// Refer AS the recruiter (an explicit recruiter on opening1) so the
		// referral's referred_by — and thus the apply notification — targets them.
		const api = new OrgAPIClient(request);
		const recruiterToken = await loginOrg(api, recruiterEmail, agencyDomain);
		const referRes = await request.post("/org/refer-candidate", {
			headers: { Authorization: `Bearer ${recruiterToken}` },
			data: { opening_id: opening1Id, candidate_handle: candidateHandle },
		});
		expect(referRes.status()).toBe(201);

		await deleteEmailsFor(recruiterEmail);
		const applyRes = await applyForOpening(
			request,
			candidateToken,
			con1Domain,
			opening1Number,
			{ applyVia: agencyDomain }
		);
		expect(applyRes.status()).toBe(201);

		const msg = await waitForEmail(
			recruiterEmail,
			{},
			/Referred candidate .* applied/i
		);
		expect(msg.Subject).toContain(candidateHandle);
	});
});

// ============================================================================
// Item 8 — referral status when the candidate applies elsewhere
// ============================================================================

test.describe("Referral not_selected transitions", () => {
	test.describe.configure({ mode: "serial" });

	const { email: conEmail, domain: conDomain } =
		generateTestOrgEmail("agns8-con");
	const { email: agencyAEmail, domain: agencyADomain } =
		generateTestOrgEmail("agns8-aga");
	const { email: agencyBEmail, domain: agencyBDomain } =
		generateTestOrgEmail("agns8-agb");
	const cand1Email = generateTestEmail("agns8-c1");
	const cand2Email = generateTestEmail("agns8-c2");

	let conToken: string;
	let agencyAToken: string;
	let agencyBToken: string;
	let cand1Token: string;
	let cand1Handle: string;
	let cand2Token: string;
	let cand2Handle: string;
	let openingId: string;
	let openingNumber: number;

	async function referralStateFor(
		request: import("@playwright/test").APIRequestContext,
		token: string,
		handle: string
	): Promise<string | undefined> {
		const res = await request.post("/org/list-agency-referrals", {
			headers: { Authorization: `Bearer ${token}` },
			data: { limit: 50 },
		});
		expect(res.status()).toBe(200);
		const body = (await res.json()) as ListAgencyReferralsResponse;
		return body.referrals.find((r) => r.candidate_handle === handle)?.state;
	}

	test.beforeAll(async ({ playwright }) => {
		const request = await playwright.request.newContext({ baseURL: BASE });
		const api = new OrgAPIClient(request);

		const con = await createTestOrgAdminDirect(conEmail, TEST_PASSWORD);
		conToken = await loginOrg(api, conEmail, conDomain);
		const agencyA = await createTestOrgAdminDirect(agencyAEmail, TEST_PASSWORD);
		agencyAToken = await loginOrg(api, agencyAEmail, agencyADomain);
		const agencyB = await createTestOrgAdminDirect(agencyBEmail, TEST_PASSWORD);
		agencyBToken = await loginOrg(api, agencyBEmail, agencyBDomain);

		for (const ag of [agencyA, agencyB]) {
			const listing = await createTestMarketplaceListingDirect(
				ag.orgId,
				ag.orgId === agencyA.orgId ? agencyADomain : agencyBDomain,
				["staffing"],
				"active"
			);
			await createTestMarketplaceSubscriptionDirect(
				con.orgId,
				"ind1",
				ag.orgId,
				"ind1",
				listing.listingId
			);
		}

		const opening = await createTestOpeningDirect(
			con.orgId,
			con.orgUserId,
			"Shared Role"
		);
		openingId = opening.openingId;
		openingNumber = opening.openingNumber;

		// Consumer assigns BOTH agencies to the opening.
		for (const dom of [agencyADomain, agencyBDomain]) {
			const res = await request.post("/org/assign-opening-agency", {
				headers: { Authorization: `Bearer ${conToken}` },
				data: { opening_id: openingId, agency_org_domain: dom },
			});
			expect(res.status()).toBe(200);
		}

		const c1 = await createTestHubUserDirect(
			cand1Email,
			TEST_PASSWORD,
			"agns8c1"
		);
		cand1Token = c1.sessionToken;
		cand1Handle = c1.handle;
		const c2 = await createTestHubUserDirect(
			cand2Email,
			TEST_PASSWORD,
			"agns8c2"
		);
		cand2Token = c2.sessionToken;
		cand2Handle = c2.handle;

		await request.dispose();
	});

	test.afterAll(async () => {
		await deleteTestHubUser(cand1Email).catch(() => {});
		await deleteTestHubUser(cand2Email).catch(() => {});
		await deleteTestOrgUser(conEmail).catch(() => {});
		await deleteTestOrgUser(agencyAEmail).catch(() => {});
		await deleteTestOrgUser(agencyBEmail).catch(() => {});
		await deleteTestGlobalOrgDomain(conDomain).catch(() => {});
		await deleteTestGlobalOrgDomain(agencyADomain).catch(() => {});
		await deleteTestGlobalOrgDomain(agencyBDomain).catch(() => {});
	});

	test("candidate applies directly (affirmed) -> pending referral becomes not_selected", async ({
		request,
	}) => {
		// agencyA refers candidate1.
		const referRes = await request.post("/org/refer-candidate", {
			headers: { Authorization: `Bearer ${agencyAToken}` },
			data: { opening_id: openingId, candidate_handle: cand1Handle },
		});
		expect(referRes.status()).toBe(201);
		expect(await referralStateFor(request, agencyAToken, cand1Handle)).toBe(
			"pending"
		);

		// candidate1 applies directly, affirming no agency.
		const applyRes = await applyForOpening(
			request,
			cand1Token,
			conDomain,
			openingNumber,
			{ applyVia: "direct", directAffirm: true }
		);
		expect(applyRes.status()).toBe(201);

		expect(await referralStateFor(request, agencyAToken, cand1Handle)).toBe(
			"not_selected"
		);
	});

	test("candidate applies via agency B -> A becomes not_selected, B accepted_applied", async ({
		request,
	}) => {
		// Both agencies refer candidate2.
		const refA = await request.post("/org/refer-candidate", {
			headers: { Authorization: `Bearer ${agencyAToken}` },
			data: { opening_id: openingId, candidate_handle: cand2Handle },
		});
		expect(refA.status()).toBe(201);
		const refB = await request.post("/org/refer-candidate", {
			headers: { Authorization: `Bearer ${agencyBToken}` },
			data: { opening_id: openingId, candidate_handle: cand2Handle },
		});
		expect(refB.status()).toBe(201);

		// candidate2 applies via agency B.
		const applyRes = await applyForOpening(
			request,
			cand2Token,
			conDomain,
			openingNumber,
			{ applyVia: agencyBDomain }
		);
		expect(applyRes.status()).toBe(201);

		expect(await referralStateFor(request, agencyBToken, cand2Handle)).toBe(
			"accepted_applied"
		);
		expect(await referralStateFor(request, agencyAToken, cand2Handle)).toBe(
			"not_selected"
		);
	});
});

// ============================================================================
// Item 3 — needs-reassignment email alert when an opening's assignee is disabled
// ============================================================================

test.describe("Needs-reassignment alert on assignee disable", () => {
	test.describe.configure({ mode: "serial" });

	const { email: consumerEmail, domain: consumerDomain } =
		generateTestOrgEmail("agnr-consumer");
	const { email: agencyEmail, domain: agencyDomain } =
		generateTestOrgEmail("agnr-agency");
	const recAEmail = `rec-a@${agencyDomain}`;
	const recBEmail = `rec-b@${agencyDomain}`;

	let consumerToken: string;
	let agencyToken: string;
	let recAOrgUserId: string;
	let openingId: string;

	test.beforeAll(async ({ playwright }) => {
		const request = await playwright.request.newContext({ baseURL: BASE });
		const api = new OrgAPIClient(request);

		const consumer = await createTestOrgAdminDirect(
			consumerEmail,
			TEST_PASSWORD
		);
		consumerToken = await loginOrg(api, consumerEmail, consumerDomain);

		const agency = await createTestOrgAdminDirect(agencyEmail, TEST_PASSWORD);
		agencyToken = await loginOrg(api, agencyEmail, agencyDomain);

		const recA = await createTestOrgUserDirect(
			recAEmail,
			TEST_PASSWORD,
			"ind1",
			{
				orgId: agency.orgId,
				domain: agencyDomain,
			}
		);
		recAOrgUserId = recA.orgUserId;
		// recB exists but is never an assignee, so disabling it must not alert.
		await createTestOrgUserDirect(recBEmail, TEST_PASSWORD, "ind1", {
			orgId: agency.orgId,
			domain: agencyDomain,
		});

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

		const opening = await createTestOpeningDirect(
			consumer.orgId,
			consumer.orgUserId,
			"Coverage Role"
		);
		openingId = opening.openingId;

		// Assign the agency, then make recA the opening's single assignee.
		const aRes = await request.post("/org/assign-opening-agency", {
			headers: { Authorization: `Bearer ${consumerToken}` },
			data: { opening_id: openingId, agency_org_domain: agencyDomain },
		});
		expect(aRes.status()).toBe(200);
		const rRes = await request.post("/org/reassign-opening", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { opening_id: openingId, agency_org_user_id: recAOrgUserId },
		});
		expect(rRes.status()).toBe(200);

		await request.dispose();
	});

	test.afterAll(async () => {
		await deleteTestOrgUser(recAEmail).catch(() => {});
		await deleteTestOrgUser(recBEmail).catch(() => {});
		await deleteTestOrgUser(consumerEmail).catch(() => {});
		await deleteTestOrgUser(agencyEmail).catch(() => {});
		await deleteTestGlobalOrgDomain(consumerDomain).catch(() => {});
		await deleteTestGlobalOrgDomain(agencyDomain).catch(() => {});
	});

	test("disabling a non-assignee user does NOT alert", async ({ request }) => {
		await deleteEmailsFor(agencyEmail);
		const res = await request.post("/org/disable-user", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { email_address: recBEmail },
		});
		expect(res.status()).toBe(200);

		await new Promise((r) => setTimeout(r, 3000));
		const msgs = await searchEmails(agencyEmail);
		const alerts = msgs.filter((m) => /new assignee/i.test(m.Subject));
		expect(alerts.length).toBe(0);
	});

	test("disabling an opening's assignee alerts the agency leads", async ({
		request,
	}) => {
		await deleteEmailsFor(agencyEmail);
		const res = await request.post("/org/disable-user", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { email_address: recAEmail },
		});
		expect(res.status()).toBe(200);

		const msg = await waitForEmail(agencyEmail, {}, /new assignee/i);
		expect(msg.Subject).toMatch(/new assignee/i);
	});
});
