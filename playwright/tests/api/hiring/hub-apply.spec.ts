/**
 * Tests for hub-side application endpoints:
 * - POST /hub/apply-for-opening  (multipart)
 * - POST /hub/withdraw-application
 * - POST /hub/get-my-application
 * - POST /hub/list-my-applications (keyset pagination)
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
	deleteTestGlobalOrgDomain,
	createTestOpeningDirect,
	createTestHubConnectionDirect,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";

// Minimal valid PDF file
const MINIMAL_PDF = Buffer.from(
	"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
		"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
		"3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\n" +
		"xref\n0 4\n0000000000 65535 f\n" +
		"trailer<</Size 4/Root 1 0 R>>\nstartxref\n%%EOF\n"
);

// Cover letter that meets 100-char minimum
const MIN_COVER =
	"I am highly qualified for this position. I have extensive experience in the relevant technologies and teams. Looking forward to contributing to your team's success.";

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

test.describe("Hub Apply for Opening", () => {
	test.describe.configure({ mode: "serial" });

	// Org A: used for most tests
	const { email: orgAEmail, domain: orgADomain } =
		generateTestOrgEmail("hub-apply-a");
	// Org B: used for second-org tests (live_application_exists check)
	const { email: orgBEmail, domain: orgBDomain } =
		generateTestOrgEmail("hub-apply-b");

	let orgAId: string;
	let orgAUserId: string;
	let orgBId: string;
	let orgBUserId: string;
	let openingANumber: number;
	let openingAId: string;
	let openingA2Number: number;
	let openingBNumber: number;

	const hubEmailsToCleanup: string[] = [];

	/**
	 * Creates a fresh hub user for one apply test.
	 * Each user has no existing applications so constraints won't conflict.
	 */
	async function freshHubUser(): Promise<{
		email: string;
		token: string;
	}> {
		const email = generateTestEmail("apphub");
		const result = await createTestHubUserDirect(
			email,
			TEST_PASSWORD,
			"apphub"
		);
		hubEmailsToCleanup.push(email);
		return { email, token: result.sessionToken };
	}

	test.beforeAll(async ({ request }) => {
		const orgApi = new OrgAPIClient(request);

		const rA = await createTestOrgAdminDirect(orgAEmail, TEST_PASSWORD);
		orgAId = rA.orgId;
		orgAUserId = rA.orgUserId;

		const rB = await createTestOrgAdminDirect(orgBEmail, TEST_PASSWORD);
		orgBId = rB.orgId;
		orgBUserId = rB.orgUserId;

		const opA = await createTestOpeningDirect(
			orgAId,
			orgAUserId,
			"Hub Apply Opening A"
		);
		openingAId = opA.openingId;
		openingANumber = opA.openingNumber;

		const opA2 = await createTestOpeningDirect(
			orgAId,
			orgAUserId,
			"Hub Apply Opening A2"
		);
		openingA2Number = opA2.openingNumber;

		const opB = await createTestOpeningDirect(
			orgBId,
			orgBUserId,
			"Hub Apply Opening B"
		);
		openingBNumber = opB.openingNumber;
	});

	test.afterAll(async () => {
		for (const email of hubEmailsToCleanup) {
			await deleteTestHubUser(email).catch(() => {});
		}
		await deleteTestGlobalOrgDomain(orgADomain);
		await deleteTestGlobalOrgDomain(orgBDomain);
	});

	// ─── apply-for-opening success ────────────────────────────────────────────────

	test("apply-for-opening: success returns application_id; appears in list-my-applications", async ({
		request,
	}) => {
		const { token } = await freshHubUser();
		const hubClient = new HubAPIClient(request);

		const applyRes = await hubClient.applyForOpeningMultipart(token, {
			org_domain: orgADomain,
			opening_number: openingANumber,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		expect(applyRes.status).toBe(201);
		expect(typeof applyRes.body!.application_id).toBe("string");

		const applicationId = applyRes.body!.application_id;

		// Appears in list-my-applications
		const listRes = await hubClient.listMyApplications(token, {});
		expect(listRes.status).toBe(200);
		const found = listRes.body!.applications.find(
			(a: { application_id: string }) => a.application_id === applicationId
		);
		expect(found).toBeDefined();
		expect(found!.state).toBe("applied");
		expect(found!.org_domain).toBe(orgADomain);

		// Audit log written for the apply
		const auditRes = await hubClient.listAuditLogs(token, {
			event_types: ["hub.apply_for_opening"],
		});
		expect(auditRes.status).toBe(200);
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "hub.apply_for_opening" &&
				e.event_data?.opening_number === openingANumber
		);
		expect(entry).toBeDefined();
	});

	test("apply-for-opening: 409 live_application_exists when a live application exists at the same org for a different opening", async ({
		request,
	}) => {
		const { token } = await freshHubUser();
		const hubClient = new HubAPIClient(request);

		const first = await hubClient.applyForOpeningMultipart(token, {
			org_domain: orgADomain,
			opening_number: openingANumber,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		expect(first.status).toBe(201);

		// Apply to a DIFFERENT opening at the SAME org while the first is live
		const second = await hubClient.applyForOpeningMultipart(token, {
			org_domain: orgADomain,
			opening_number: openingA2Number,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		expect(second.status).toBe(409);
		expect((second.body as unknown as { error: string }).error).toBe(
			"live_application_exists"
		);
	});

	test("apply-for-opening: 400 not_a_connection when an endorser handle is not a confirmed connection", async ({
		request,
	}) => {
		const { token } = await freshHubUser();
		const hubClient = new HubAPIClient(request);

		const res = await hubClient.applyForOpeningMultipart(token, {
			org_domain: orgADomain,
			opening_number: openingANumber,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
			endorser_handles: ["not-a-real-connection-handle"],
		});
		expect(res.status).toBe(400);
		const body = res.body as unknown as { error: string; handles: string[] };
		expect(body.error).toBe("not_a_connection");
		expect(body.handles).toContain("not-a-real-connection-handle");
	});

	test("apply-for-opening: endorser_handles creates endorsement requests visible to the endorser", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);

		// Candidate + endorser, made into confirmed connections
		const candEmail = generateTestEmail("apncand");
		const cand = await createTestHubUserDirect(
			candEmail,
			TEST_PASSWORD,
			"apncand"
		);
		hubEmailsToCleanup.push(candEmail);

		const endEmail = generateTestEmail("apnend");
		const endorser = await createTestHubUserDirect(
			endEmail,
			TEST_PASSWORD,
			"apnend"
		);
		hubEmailsToCleanup.push(endEmail);

		await createTestHubConnectionDirect(
			cand.hubUserGlobalId,
			cand.handle,
			endorser.hubUserGlobalId,
			endorser.handle
		);

		const applyRes = await hubClient.applyForOpeningMultipart(
			cand.sessionToken,
			{
				org_domain: orgADomain,
				opening_number: openingANumber,
				cover_letter: MIN_COVER,
				resume: MINIMAL_PDF,
				endorser_handles: [endorser.handle],
				endorsement_request_note: "We worked together at Acme.",
			}
		);
		expect(applyRes.status).toBe(201);
		const applicationId = applyRes.body!.application_id;

		// The endorser sees an incoming endorsement request for this application
		const incoming = await hubClient.listEndorsementRequestsIncoming(
			endorser.sessionToken,
			{}
		);
		expect(incoming.status).toBe(200);
		const reqForApp = incoming.body!.requests.find(
			(r) => r.application_id === applicationId
		);
		expect(reqForApp).toBeDefined();
		expect(reqForApp!.state).toBe("pending");
	});

	test("apply-for-opening: 409 when already applied to same opening", async ({
		request,
	}) => {
		const { token } = await freshHubUser();
		const hubClient = new HubAPIClient(request);

		await hubClient.applyForOpeningMultipart(token, {
			org_domain: orgADomain,
			opening_number: openingANumber,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});

		// Second apply to same opening → 409 already_applied
		const res2 = await hubClient.applyForOpeningMultipart(token, {
			org_domain: orgADomain,
			opening_number: openingANumber,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		expect(res2.status).toBe(409);
	});

	test("apply-for-opening: 400 when cover_letter < 100 chars", async ({
		request,
	}) => {
		const { token } = await freshHubUser();
		const hubClient = new HubAPIClient(request);

		const res = await hubClient.applyForOpeningMultipart(token, {
			org_domain: orgADomain,
			opening_number: openingANumber,
			cover_letter: "Too short.",
			resume: MINIMAL_PDF,
		});
		expect(res.status).toBe(400);
	});

	test("apply-for-opening: 400 when resume is not PDF or DOCX", async ({
		request,
	}) => {
		const { token } = await freshHubUser();
		const hubClient = new HubAPIClient(request);

		const res = await hubClient.applyForOpeningMultipart(token, {
			org_domain: orgADomain,
			opening_number: openingANumber,
			cover_letter: MIN_COVER,
			resume: Buffer.from("this is not a valid file format at all"),
		});
		expect(res.status).toBe(400);
	});

	test("apply-for-opening: 404 when opening does not exist", async ({
		request,
	}) => {
		const { token } = await freshHubUser();
		const hubClient = new HubAPIClient(request);

		const res = await hubClient.applyForOpeningMultipart(token, {
			org_domain: orgADomain,
			opening_number: 999999,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		expect(res.status).toBe(404);
	});

	test("apply-for-opening: 401 when unauthenticated", async ({ request }) => {
		const res = await request.post("/hub/apply-for-opening", {
			multipart: {
				org_domain: orgADomain,
				opening_number: String(openingANumber),
				cover_letter: MIN_COVER,
				resume: {
					name: "r.pdf",
					mimeType: "application/pdf",
					buffer: MINIMAL_PDF,
				},
			},
		});
		expect(res.status()).toBe(401);
	});

	// ─── get-my-application ───────────────────────────────────────────────────────

	test("get-my-application: returns correct fields after applying", async ({
		request,
	}) => {
		const { token } = await freshHubUser();
		const hubClient = new HubAPIClient(request);

		const applyRes = await hubClient.applyForOpeningMultipart(token, {
			org_domain: orgADomain,
			opening_number: openingANumber,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		expect(applyRes.status).toBe(201);
		const applicationId = applyRes.body!.application_id;

		const getRes = await hubClient.getMyApplication(token, {
			application_id: applicationId,
		});
		expect(getRes.status).toBe(200);
		expect(getRes.body!.application_id).toBe(applicationId);
		expect(getRes.body!.state).toBe("applied");
		expect(getRes.body!.cover_letter).toBe(MIN_COVER);
		expect(Array.isArray(getRes.body!.endorsements)).toBe(true);
		expect(getRes.body!.notify_colleagues_at_target).toBe(false);
		expect(typeof getRes.body!.applied_at).toBe("string");
	});

	test("get-my-application: 404 when application belongs to another user", async ({
		request,
	}) => {
		// User A applies, user B tries to get it
		const userA = await freshHubUser();
		const userB = await freshHubUser();
		const hubClient = new HubAPIClient(request);

		const applyRes = await hubClient.applyForOpeningMultipart(userA.token, {
			org_domain: orgADomain,
			opening_number: openingANumber,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		expect(applyRes.status).toBe(201);

		const getRes = await hubClient.getMyApplication(userB.token, {
			application_id: applyRes.body!.application_id,
		});
		expect(getRes.status).toBe(404);
	});

	test("get-my-application: 401 when unauthenticated", async ({ request }) => {
		const { token } = await freshHubUser();
		const hubClient = new HubAPIClient(request);
		const applyRes = await hubClient.applyForOpeningMultipart(token, {
			org_domain: orgADomain,
			opening_number: openingANumber,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		const applicationId = applyRes.body!.application_id;

		const res = await request.post("/hub/get-my-application", {
			data: { application_id: applicationId },
		});
		expect(res.status()).toBe(401);
	});

	// ─── withdraw-application ─────────────────────────────────────────────────────

	test("withdraw-application: transitions to withdrawn, then appears as withdrawn in list", async ({
		request,
	}) => {
		const { token } = await freshHubUser();
		const hubClient = new HubAPIClient(request);

		const applyRes = await hubClient.applyForOpeningMultipart(token, {
			org_domain: orgADomain,
			opening_number: openingANumber,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		expect(applyRes.status).toBe(201);
		const applicationId = applyRes.body!.application_id;

		const withdrawRes = await hubClient.withdrawApplication(token, {
			application_id: applicationId,
		});
		expect(withdrawRes.status).toBe(200);

		// State is now withdrawn
		const getRes = await hubClient.getMyApplication(token, {
			application_id: applicationId,
		});
		expect(getRes.body!.state).toBe("withdrawn");

		// Audit log written
		const auditRes = await hubClient.listAuditLogs(token, {
			event_types: ["hub.withdraw_application"],
		});
		expect(auditRes.status).toBe(200);
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "hub.withdraw_application" &&
				e.event_data?.application_id === applicationId
		);
		expect(entry).toBeDefined();
	});

	test("withdraw-application: 422 when already withdrawn", async ({
		request,
	}) => {
		const { token } = await freshHubUser();
		const hubClient = new HubAPIClient(request);

		const applyRes = await hubClient.applyForOpeningMultipart(token, {
			org_domain: orgADomain,
			opening_number: openingANumber,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		const applicationId = applyRes.body!.application_id;

		await hubClient.withdrawApplication(token, {
			application_id: applicationId,
		});
		const res2 = await hubClient.withdrawApplication(token, {
			application_id: applicationId,
		});
		expect(res2.status).toBe(422);
	});

	test("withdraw-application: 401 when unauthenticated", async ({
		request,
	}) => {
		const { token } = await freshHubUser();
		const hubClient = new HubAPIClient(request);
		const applyRes = await hubClient.applyForOpeningMultipart(token, {
			org_domain: orgADomain,
			opening_number: openingANumber,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		const applicationId = applyRes.body!.application_id;

		const res = await request.post("/hub/withdraw-application", {
			data: { application_id: applicationId },
		});
		expect(res.status()).toBe(401);
	});

	// ─── list-my-applications keyset pagination ───────────────────────────────────

	test("list-my-applications: limit=1 returns one item with correct fields and cursor", async ({
		request,
	}) => {
		// Use one hub user with apps at two different orgs (respects unique-per-org constraint)
		const email = generateTestEmail("pag-multi");
		const hub = await createTestHubUserDirect(email, TEST_PASSWORD, "pagmulti");
		hubEmailsToCleanup.push(email);
		const hubClient = new HubAPIClient(request);

		// Apply to org A
		await hubClient.applyForOpeningMultipart(hub.sessionToken, {
			org_domain: orgADomain,
			opening_number: openingANumber,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		// Apply to org B
		await hubClient.applyForOpeningMultipart(hub.sessionToken, {
			org_domain: orgBDomain,
			opening_number: openingBNumber,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});

		const page1 = await hubClient.listMyApplications(hub.sessionToken, {
			limit: 1,
		});
		expect(page1.status).toBe(200);
		expect(page1.body!.applications.length).toBe(1);
		expect(typeof page1.body!.next_pagination_key).toBe("string");

		const page2 = await hubClient.listMyApplications(hub.sessionToken, {
			limit: 1,
			pagination_key: page1.body!.next_pagination_key,
		});
		expect(page2.status).toBe(200);
		expect(page2.body!.applications.length).toBe(1);

		// Pages must not overlap
		expect(page1.body!.applications[0].application_id).not.toBe(
			page2.body!.applications[0].application_id
		);

		// Each item has correct fields
		const item = page1.body!.applications[0];
		expect(typeof item.application_id).toBe("string");
		expect(typeof item.org_domain).toBe("string");
		expect(item.state).toBe("applied");
		expect(typeof item.applied_at).toBe("string");
	});
});

// ─── cool-off window ──────────────────────────────────────────────────────────
// A dedicated org so toggling cool_off_days does not affect the other suite.
test.describe("Hub Apply cool-off", () => {
	test.describe.configure({ mode: "serial" });

	const { email: orgEmail, domain: orgDomain } =
		generateTestOrgEmail("hub-apply-cool");
	let orgId: string;
	let orgUserId: string;
	let orgToken: string;
	let opening1Number: number;
	let opening2Number: number;
	const hubEmailsToCleanup: string[] = [];

	test.beforeAll(async ({ request }) => {
		const r = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
		orgId = r.orgId;
		orgUserId = r.orgUserId;
		const op1 = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"Cool Opening 1"
		);
		opening1Number = op1.openingNumber;
		const op2 = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"Cool Opening 2"
		);
		opening2Number = op2.openingNumber;
		const orgApi = new OrgAPIClient(request);
		orgToken = await loginOrgUser(orgApi, orgEmail, orgDomain);
	});

	test.afterAll(async () => {
		for (const email of hubEmailsToCleanup) {
			await deleteTestHubUser(email).catch(() => {});
		}
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	test("apply-for-opening: 422 cool_off_active after reaching candidacy within the window", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const orgApi = new OrgAPIClient(request);

		const email = generateTestEmail("coolhub");
		const hub = await createTestHubUserDirect(email, TEST_PASSWORD, "coolhub");
		hubEmailsToCleanup.push(email);

		// Apply to opening 1, then org shortlists it → candidacy reached
		const apply1 = await hubClient.applyForOpeningMultipart(hub.sessionToken, {
			org_domain: orgDomain,
			opening_number: opening1Number,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		expect(apply1.status).toBe(201);

		const shortlist = await orgApi.shortlistApplication(orgToken, {
			application_id: apply1.body!.application_id,
		});
		expect(shortlist.status).toBe(200);

		// Applying to opening 2 (same org) within the default 90-day window → 422
		const apply2 = await hubClient.applyForOpeningMultipart(hub.sessionToken, {
			org_domain: orgDomain,
			opening_number: opening2Number,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		expect(apply2.status).toBe(422);
		const body = apply2.body as unknown as {
			error: string;
			earliest_next_apply_at: string;
		};
		expect(body.error).toBe("cool_off_active");
		expect(typeof body.earliest_next_apply_at).toBe("string");
		expect(Number.isNaN(Date.parse(body.earliest_next_apply_at))).toBe(false);
	});

	test("apply-for-opening: cool_off_days=0 disables cool-off (live check applies instead)", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const orgApi = new OrgAPIClient(request);

		// Disable cool-off for this org
		const upd = await orgApi.updateHiringSettings(orgToken, {
			cool_off_days: 0,
		});
		expect(upd.status).toBe(200);

		const email = generateTestEmail("nocoolhub");
		const hub = await createTestHubUserDirect(
			email,
			TEST_PASSWORD,
			"nocoolhub"
		);
		hubEmailsToCleanup.push(email);

		const apply1 = await hubClient.applyForOpeningMultipart(hub.sessionToken, {
			org_domain: orgDomain,
			opening_number: opening1Number,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		expect(apply1.status).toBe(201);

		const shortlist = await orgApi.shortlistApplication(orgToken, {
			application_id: apply1.body!.application_id,
		});
		expect(shortlist.status).toBe(200);

		// With cool-off disabled, the live-application rule fires (409), not 422
		const apply2 = await hubClient.applyForOpeningMultipart(hub.sessionToken, {
			org_domain: orgDomain,
			opening_number: opening2Number,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		expect(apply2.status).toBe(409);
		expect((apply2.body as unknown as { error: string }).error).toBe(
			"live_application_exists"
		);
	});
});
