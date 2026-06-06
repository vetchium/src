/**
 * Tests for offer-letter retrieval and the hub-side offer view:
 * - GET /org/offer-letter/{candidacyId}   (hiring team streams the document)
 * - GET /hub/offer-letter/{candidacyId}   (candidate streams the document)
 * - org get-candidacy / hub get-my-candidacy expose the offer + download URL
 *
 * Covers success (PDF + Markdown), ownership/RBAC isolation, missing offer, and
 * unauthenticated access. Compensation is not a structured field — the document
 * is the source of truth — so these tests assert the document round-trips.
 */

import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import { HubAPIClient } from "../../../lib/hub-api-client";
import {
	createTestOrgAdminDirect,
	createTestHubUserDirect,
	generateTestOrgEmail,
	generateTestEmail,
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

const MINIMAL_PDF = Buffer.from(
	"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
		"trailer<</Root 1 0 R>>\n%%EOF\n"
);
const MD_OFFER = Buffer.from(
	"# Offer of Employment\n\nWe are delighted to offer you the role.\n"
);
const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

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

test.describe("Offer letter retrieval", () => {
	test.describe.configure({ mode: "serial" });

	const { email: adminEmail, domain: orgDomain } =
		generateTestOrgEmail("offer-dl");
	const { email: orgBEmail, domain: orgBDomain } =
		generateTestOrgEmail("offer-dl-b");
	const hubEmail = generateTestEmail("offer-dl-hub");
	const otherHubEmail = generateTestEmail("offer-dl-other");

	let adminToken: string;
	let orgBToken: string;
	let orgId: string;
	let adminUserId: string;
	let hubToken: string;
	let hubGlobalId: string;
	let hubHandle: string;
	let otherHubToken: string;
	let candidacyId: string; // has a PDF offer
	let noOfferCandidacyId: string; // shortlisted, no offer extended

	test.beforeAll(async ({ request }) => {
		const orgApi = new OrgAPIClient(request);

		const admin = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		orgId = admin.orgId;
		adminUserId = admin.orgUserId;
		adminToken = await loginOrgUser(orgApi, adminEmail, orgDomain);

		const orgB = await createTestOrgAdminDirect(orgBEmail, TEST_PASSWORD);
		void orgB;
		orgBToken = await loginOrgUser(orgApi, orgBEmail, orgBDomain);

		const hub = await createTestHubUserDirect(
			hubEmail,
			TEST_PASSWORD,
			"offerdl"
		);
		hubToken = hub.sessionToken;
		hubGlobalId = hub.hubUserGlobalId;
		hubHandle = hub.handle;

		const other = await createTestHubUserDirect(
			otherHubEmail,
			TEST_PASSWORD,
			"offerdlother"
		);
		otherHubToken = other.sessionToken;

		const opening = await createTestOpeningDirect(
			orgId,
			adminUserId,
			"Offer Download Opening"
		);

		// Candidacy with a PDF offer.
		const appId = await createTestApplicationDirect(
			orgId,
			orgDomain,
			opening.openingId,
			opening.openingNumber,
			hubGlobalId,
			hubHandle,
			"Offer Download Candidate"
		);
		const sr = await orgApi.shortlistApplication(adminToken, {
			application_id: appId,
		});
		expect(sr.status).toBe(200);
		candidacyId = sr.body.candidacy_id;
		const ext = await orgApi.extendOffer(adminToken, candidacyId, MINIMAL_PDF, {
			start_date: "2027-02-01",
			notes: "Looking forward to working with you.",
		});
		expect(ext.status).toBe(201);

		// A second candidacy that never receives an offer.
		const other2 = await createTestHubUserDirect(
			generateTestEmail("offer-dl-nooffer"),
			TEST_PASSWORD,
			"offerdlno"
		);
		const appId2 = await createTestApplicationDirect(
			orgId,
			orgDomain,
			opening.openingId,
			opening.openingNumber,
			other2.hubUserGlobalId,
			other2.handle,
			"No Offer Candidate"
		);
		const sr2 = await orgApi.shortlistApplication(adminToken, {
			application_id: appId2,
		});
		expect(sr2.status).toBe(200);
		noOfferCandidacyId = sr2.body.candidacy_id;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(hubEmail).catch(() => {});
		await deleteTestHubUser(otherHubEmail).catch(() => {});
		await deleteTestGlobalOrgDomain(orgDomain).catch(() => {});
		await deleteTestGlobalOrgDomain(orgBDomain).catch(() => {});
	});

	// ─── org get-candidacy exposes the offer + download URL ───────────────────────

	test("org get-candidacy: returns offer with a download URL and no salary fields", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.getCandidacy(adminToken, {
			candidacy_id: candidacyId,
		});
		expect(res.status).toBe(200);
		expect(res.body.offer).toBeTruthy();
		const offer = res.body.offer!;
		expect(offer.offer_letter_download_url).toBe(
			`/org/offer-letter/${candidacyId}`
		);
		expect(offer.start_date).toBe("2027-02-01");
		// Salary fields were removed from the API contract.
		const raw = offer as unknown as Record<string, unknown>;
		expect(raw.salary_currency).toBeUndefined();
		expect(raw.salary_amount).toBeUndefined();
	});

	// ─── GET /org/offer-letter ────────────────────────────────────────────────────

	test("org offer-letter: hiring team downloads the PDF → 200", async ({
		request,
	}) => {
		const res = await request.get(`/org/offer-letter/${candidacyId}`, {
			headers: { Authorization: `Bearer ${adminToken}` },
		});
		expect(res.status()).toBe(200);
		expect(res.headers()["content-type"]).toContain("application/pdf");
		const body = await res.body();
		expect(body.subarray(0, 4).toString()).toBe("%PDF");
	});

	test("org offer-letter: another org → 403", async ({ request }) => {
		const res = await request.get(`/org/offer-letter/${candidacyId}`, {
			headers: { Authorization: `Bearer ${orgBToken}` },
		});
		expect(res.status()).toBe(403);
	});

	test("org offer-letter: candidacy without an offer → 404", async ({
		request,
	}) => {
		const res = await request.get(`/org/offer-letter/${noOfferCandidacyId}`, {
			headers: { Authorization: `Bearer ${adminToken}` },
		});
		expect(res.status()).toBe(404);
	});

	test("org offer-letter: nonexistent candidacy → 404", async ({ request }) => {
		const res = await request.get(`/org/offer-letter/${NONEXISTENT_ID}`, {
			headers: { Authorization: `Bearer ${adminToken}` },
		});
		expect(res.status()).toBe(404);
	});

	test("org offer-letter: unauthenticated → 401", async ({ request }) => {
		const res = await request.get(`/org/offer-letter/${candidacyId}`);
		expect(res.status()).toBe(401);
	});

	// ─── hub get-my-candidacy exposes the offer + GET /hub/offer-letter ───────────

	test("hub get-my-candidacy: returns the offer with a download URL", async ({
		request,
	}) => {
		const hub = new HubAPIClient(request);
		const res = await hub.getMyCandidacy(hubToken, {
			candidacy_id: candidacyId,
		});
		expect(res.status).toBe(200);
		expect(res.body!.offer).toBeTruthy();
		expect(res.body!.offer!.offer_letter_download_url).toBe(
			`/hub/offer-letter/${candidacyId}`
		);
		expect(res.body!.offer!.start_date).toBe("2027-02-01");
	});

	test("hub offer-letter: candidate downloads their offer → 200", async ({
		request,
	}) => {
		const res = await request.get(`/hub/offer-letter/${candidacyId}`, {
			headers: { Authorization: `Bearer ${hubToken}` },
		});
		expect(res.status()).toBe(200);
		expect(res.headers()["content-type"]).toContain("application/pdf");
		const body = await res.body();
		expect(body.subarray(0, 4).toString()).toBe("%PDF");
	});

	test("hub offer-letter: a different candidate → 404", async ({ request }) => {
		const res = await request.get(`/hub/offer-letter/${candidacyId}`, {
			headers: { Authorization: `Bearer ${otherHubToken}` },
		});
		expect(res.status()).toBe(404);
	});

	test("hub offer-letter: unauthenticated → 401", async ({ request }) => {
		const res = await request.get(`/hub/offer-letter/${candidacyId}`);
		expect(res.status()).toBe(401);
	});

	// ─── Markdown offer letters round-trip with the right content type ────────────

	test("offer-letter: a Markdown offer is served as text/markdown", async ({
		request,
	}) => {
		const orgApi = new OrgAPIClient(request);
		// Fresh candidacy for an .md offer.
		const mdHub = await createTestHubUserDirect(
			generateTestEmail("offer-md-dl"),
			TEST_PASSWORD,
			"offermddl"
		);
		const opening = await createTestOpeningDirect(
			orgId,
			adminUserId,
			"MD Offer Opening"
		);
		const appId = await createTestApplicationDirect(
			orgId,
			orgDomain,
			opening.openingId,
			opening.openingNumber,
			mdHub.hubUserGlobalId,
			mdHub.handle,
			"MD Offer Candidate"
		);
		const sr = await orgApi.shortlistApplication(adminToken, {
			application_id: appId,
		});
		expect(sr.status).toBe(200);
		const mdCandidacyId = sr.body.candidacy_id;
		const ext = await orgApi.extendOffer(adminToken, mdCandidacyId, MD_OFFER, {
			fileName: "offer.md",
			mimeType: "text/markdown",
		});
		expect(ext.status).toBe(201);

		const res = await request.get(`/org/offer-letter/${mdCandidacyId}`, {
			headers: { Authorization: `Bearer ${adminToken}` },
		});
		expect(res.status()).toBe(200);
		expect(res.headers()["content-type"]).toContain("text/markdown");
		const body = await res.body();
		expect(body.toString()).toContain("# Offer of Employment");
	});
});
