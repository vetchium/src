import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import {
	createTestOrgAdminDirect,
	createTestMarketplaceListingDirect,
	createTestMarketplaceSubscriptionDirect,
	createTestOpeningDirect,
	deleteTestOrgUser,
	deleteTestGlobalOrgDomain,
	generateTestOrgEmail,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type {
	GetAssignedOpeningResponse,
	ListAssignedOpeningsResponse,
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

// One opening can be staffed by multiple agencies; each agency has its own single
// assignee, fully independent of the others.
test.describe("Multiple agencies on one opening", () => {
	test.describe.configure({ mode: "serial" });

	const { email: consumerEmail, domain: consumerDomain } =
		generateTestOrgEmail("agmulti-consumer");
	const { email: agencyAEmail, domain: agencyADomain } =
		generateTestOrgEmail("agmulti-aga");
	const { email: agencyBEmail, domain: agencyBDomain } =
		generateTestOrgEmail("agmulti-agb");

	let consumerToken: string;
	let agencyAToken: string;
	let agencyBToken: string;
	let agencyAUserId: string;
	let agencyBUserId: string;
	let openingId: string;

	async function assignAgency(domain: string) {
		const res = await fetch(`${BASE}/org/assign-opening-agency`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${consumerToken}`,
			},
			body: JSON.stringify({
				opening_id: openingId,
				agency_org_domain: domain,
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
		consumerToken = await loginOrg(api, consumerEmail, consumerDomain);

		const agencyA = await createTestOrgAdminDirect(agencyAEmail, TEST_PASSWORD);
		agencyAUserId = agencyA.orgUserId;
		agencyAToken = await loginOrg(api, agencyAEmail, agencyADomain);

		const agencyB = await createTestOrgAdminDirect(agencyBEmail, TEST_PASSWORD);
		agencyBUserId = agencyB.orgUserId;
		agencyBToken = await loginOrg(api, agencyBEmail, agencyBDomain);

		// Both agencies offer staffing; the consumer subscribes to each.
		for (const agency of [agencyA, agencyB]) {
			const listing = await createTestMarketplaceListingDirect(
				agency.orgId,
				agency === agencyA ? agencyADomain : agencyBDomain,
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
		}

		const opening = await createTestOpeningDirect(
			consumer.orgId,
			consumer.orgUserId,
			"Shared Role"
		);
		openingId = opening.openingId;

		// Assign BOTH agencies to the same opening.
		expect(await assignAgency(agencyADomain)).toBe(200);
		expect(await assignAgency(agencyBDomain)).toBe(200);

		await request.dispose();
	});

	test.afterAll(async () => {
		await deleteTestOrgUser(consumerEmail).catch(() => {});
		await deleteTestOrgUser(agencyAEmail).catch(() => {});
		await deleteTestOrgUser(agencyBEmail).catch(() => {});
		await deleteTestGlobalOrgDomain(consumerDomain).catch(() => {});
		await deleteTestGlobalOrgDomain(agencyADomain).catch(() => {});
		await deleteTestGlobalOrgDomain(agencyBDomain).catch(() => {});
	});

	test("each agency gets its own assignee for the same opening", async ({
		request,
	}) => {
		const a = await request.post("/org/get-assigned-opening", {
			headers: { Authorization: `Bearer ${agencyAToken}` },
			data: { opening_id: openingId },
		});
		expect(a.status()).toBe(200);
		expect(
			((await a.json()) as GetAssignedOpeningResponse).opening.assignee
				?.org_user_id
		).toBe(agencyAUserId);

		const b = await request.post("/org/get-assigned-opening", {
			headers: { Authorization: `Bearer ${agencyBToken}` },
			data: { opening_id: openingId },
		});
		expect(b.status()).toBe(200);
		expect(
			((await b.json()) as GetAssignedOpeningResponse).opening.assignee
				?.org_user_id
		).toBe(agencyBUserId);
	});

	test("reassigning in agency A leaves agency B untouched", async ({
		request,
	}) => {
		// Agency A reassigns to itself (no-op target change is fine; we assert B).
		const re = await request.post("/org/reassign-opening", {
			headers: { Authorization: `Bearer ${agencyAToken}` },
			data: { opening_id: openingId, agency_org_user_id: agencyAUserId },
		});
		expect(re.status()).toBe(200);

		const b = await request.post("/org/get-assigned-opening", {
			headers: { Authorization: `Bearer ${agencyBToken}` },
			data: { opening_id: openingId },
		});
		expect(
			((await b.json()) as GetAssignedOpeningResponse).opening.assignee
				?.org_user_id
		).toBe(agencyBUserId);
	});

	test("removing agency A leaves agency B's assignment intact", async ({
		request,
	}) => {
		const rm = await request.post("/org/remove-opening-agency", {
			headers: { Authorization: `Bearer ${consumerToken}` },
			data: { opening_id: openingId, agency_org_domain: agencyADomain },
		});
		expect(rm.status()).toBe(200);

		// Agency A no longer sees the opening in its workspace.
		const aList = await request.post("/org/list-assigned-openings", {
			headers: { Authorization: `Bearer ${agencyAToken}` },
			data: { limit: 50 },
		});
		const aIds = (
			(await aList.json()) as ListAssignedOpeningsResponse
		).openings.map((o) => o.opening_id);
		expect(aIds).not.toContain(openingId);

		// Agency B still owns it, with its assignee unchanged.
		const b = await request.post("/org/get-assigned-opening", {
			headers: { Authorization: `Bearer ${agencyBToken}` },
			data: { opening_id: openingId },
		});
		expect(b.status()).toBe(200);
		expect(
			((await b.json()) as GetAssignedOpeningResponse).opening.assignee
				?.org_user_id
		).toBe(agencyBUserId);
	});
});
