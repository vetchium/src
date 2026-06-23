import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import {
	createTestHubUserDirect,
	createTestOrgAdminDirect,
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
	ListReferralsReceivedResponse,
	PendingReferralsCountResponse,
} from "vetchium-specs/hub/referrals";

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

test.describe("Pending referrals count (dashboard badge)", () => {
	test.describe.configure({ mode: "serial" });

	const { email: consumerEmail, domain: consumerDomain } =
		generateTestOrgEmail("prc-consumer");
	const { email: agencyEmail, domain: agencyDomain } =
		generateTestOrgEmail("prc-agency");
	const candidateEmail = generateTestEmail("prc-cand");

	let consumerToken: string;
	let agencyToken: string;
	let candidateToken: string;
	let candidateHandle: string;
	let consumerOrgId: string;
	let consumerOrgUserId: string;
	let agencyOrgId: string;
	let openingId: string;

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

		const opening = await createTestOpeningDirect(
			consumerOrgId,
			consumerOrgUserId,
			"Badge Role"
		);
		openingId = opening.openingId;

		const cand = await createTestHubUserDirect(
			candidateEmail,
			TEST_PASSWORD,
			"prc-cand"
		);
		candidateToken = cand.sessionToken;
		candidateHandle = cand.handle;

		// Consumer assigns the agency to its opening so the agency can refer.
		const assignRes = await request.post("/org/assign-opening-agency", {
			headers: { Authorization: `Bearer ${consumerToken}` },
			data: { opening_id: openingId, agency_org_domain: agencyDomain },
		});
		expect(assignRes.status()).toBe(200);

		await request.dispose();
	});

	test.afterAll(async () => {
		await deleteTestHubUser(candidateEmail).catch(() => {});
		await deleteTestOrgUser(consumerEmail).catch(() => {});
		await deleteTestOrgUser(agencyEmail).catch(() => {});
		await deleteTestGlobalOrgDomain(consumerDomain).catch(() => {});
		await deleteTestGlobalOrgDomain(agencyDomain).catch(() => {});
	});

	test("401 without auth", async ({ request }) => {
		const res = await request.get("/hub/pending-referrals-count");
		expect(res.status()).toBe(401);
	});

	test("count is 0 before any referral", async ({ request }) => {
		const res = await request.get("/hub/pending-referrals-count", {
			headers: { Authorization: `Bearer ${candidateToken}` },
		});
		expect(res.status()).toBe(200);
		const body = (await res.json()) as PendingReferralsCountResponse;
		expect(body.count).toBe(0);
	});

	test("count becomes 1 after a pending referral", async ({ request }) => {
		const referRes = await request.post("/org/refer-candidate", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: { opening_id: openingId, candidate_handle: candidateHandle },
		});
		expect(referRes.status()).toBe(201);

		const res = await request.get("/hub/pending-referrals-count", {
			headers: { Authorization: `Bearer ${candidateToken}` },
		});
		expect(res.status()).toBe(200);
		const body = (await res.json()) as PendingReferralsCountResponse;
		expect(body.count).toBe(1);
	});

	test("count returns to 0 after the referral is declined", async ({
		request,
	}) => {
		// Resolve the referral id from the candidate's inbox.
		const inboxRes = await request.post("/hub/list-referrals-received", {
			headers: { Authorization: `Bearer ${candidateToken}` },
			data: { limit: 20 },
		});
		expect(inboxRes.status()).toBe(200);
		const inbox = (await inboxRes.json()) as ListReferralsReceivedResponse;
		const referral = inbox.referrals.find(
			(r) => r.agency_org_domain === agencyDomain && r.state === "pending"
		);
		expect(referral).toBeDefined();

		const declineRes = await request.post("/hub/decline-referral", {
			headers: { Authorization: `Bearer ${candidateToken}` },
			data: { referral_id: referral!.referral_id },
		});
		expect(declineRes.status()).toBe(200);

		const res = await request.get("/hub/pending-referrals-count", {
			headers: { Authorization: `Bearer ${candidateToken}` },
		});
		expect(res.status()).toBe(200);
		const body = (await res.json()) as PendingReferralsCountResponse;
		expect(body.count).toBe(0);
	});
});
