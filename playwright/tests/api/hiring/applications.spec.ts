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

test.describe("Hiring Applications", () => {
	test.describe.configure({ mode: "serial" });

	// Org A — primary org under test
	const { email: orgAEmail, domain: orgADomain } =
		generateTestOrgEmail("app-orga");
	// Org B — used solely to test cross-org 404 isolation
	const { email: orgBEmail, domain: orgBDomain } =
		generateTestOrgEmail("app-orgb");

	let orgAToken: string;
	let orgBToken: string;
	let orgAId: string;
	let orgAUserId: string;
	let orgBId: string;
	let orgBUserId: string;
	let openingAId: string;
	let openingANumber: number;
	let openingBId: string;
	let openingBNumber: number;

	const hubEmailsToCleanup: string[] = [];

	/**
	 * Creates a unique hub user + application against org A's opening.
	 * Each call produces an independent application_id from the API.
	 */
	async function freshApp(): Promise<{
		hubToken: string;
		hubHandle: string;
		applicationId: string;
	}> {
		const email = generateTestEmail("app-hub");
		const hub = await createTestHubUserDirect(email, TEST_PASSWORD, "apphub");
		hubEmailsToCleanup.push(email);
		const appId = await createTestApplicationDirect(
			orgAId,
			orgADomain,
			openingAId,
			openingANumber,
			hub.hubUserGlobalId,
			hub.handle,
			`Candidate ${hub.handle}`
		);
		return {
			hubToken: hub.sessionToken,
			hubHandle: hub.handle,
			applicationId: appId,
		};
	}

	test.beforeAll(async ({ request }) => {
		const orgApi = new OrgAPIClient(request);

		const rA = await createTestOrgAdminDirect(orgAEmail, TEST_PASSWORD);
		orgAId = rA.orgId;
		orgAUserId = rA.orgUserId;
		orgAToken = await loginOrgUser(orgApi, orgAEmail, orgADomain);

		const rB = await createTestOrgAdminDirect(orgBEmail, TEST_PASSWORD);
		orgBId = rB.orgId;
		orgBUserId = rB.orgUserId;
		orgBToken = await loginOrgUser(orgApi, orgBEmail, orgBDomain);

		const opA = await createTestOpeningDirect(
			orgAId,
			orgAUserId,
			"Org A Opening"
		);
		openingAId = opA.openingId;
		openingANumber = opA.openingNumber;

		const opB = await createTestOpeningDirect(
			orgBId,
			orgBUserId,
			"Org B Opening"
		);
		openingBId = opB.openingId;
		openingBNumber = opB.openingNumber;
	});

	test.afterAll(async () => {
		for (const email of hubEmailsToCleanup) {
			await deleteTestHubUser(email).catch(() => {});
		}
		await deleteTestGlobalOrgDomain(orgADomain);
		await deleteTestGlobalOrgDomain(orgBDomain);
	});

	// ─── Hub: list own applications ───────────────────────────────────────────────

	test("Hub user can list their applications — specific app appears with correct fields", async ({
		request,
	}) => {
		const { hubToken, applicationId, hubHandle } = await freshApp();
		const hubClient = new HubAPIClient(request);
		const res = await hubClient.listMyApplications(hubToken, {});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body!.applications)).toBe(true);

		const found = res.body!.applications.find(
			(a: { application_id: string }) => a.application_id === applicationId
		);
		expect(found).toBeDefined();
		expect(found!.state).toBe("applied");
		// Hub-side summary shows org + opening info (the hub user is the candidate)
		expect(typeof found!.org_domain).toBe("string");
		expect(typeof found!.opening_title).toBe("string");
		expect(typeof found!.applied_at).toBe("string");
	});

	test("Hub list-my-applications: limit=1 returns one item; cursor fetches next distinct page", async ({
		request,
	}) => {
		// Need a hub user with 2 applications at 2 different orgs to test pagination
		const email = generateTestEmail("app-pag-hub");
		const hub = await createTestHubUserDirect(email, TEST_PASSWORD, "pagHub");
		hubEmailsToCleanup.push(email);

		// App at org A
		await createTestApplicationDirect(
			orgAId,
			orgADomain,
			openingAId,
			openingANumber,
			hub.hubUserGlobalId,
			hub.handle,
			`Pag Candidate A`
		);
		// App at org B (different org, so the unique-per-org constraint allows it)
		await createTestApplicationDirect(
			orgBId,
			orgBDomain,
			openingBId,
			openingBNumber,
			hub.hubUserGlobalId,
			hub.handle,
			`Pag Candidate B`
		);

		const hubClient = new HubAPIClient(request);
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
	});

	// ─── Org: list-applications ───────────────────────────────────────────────────

	test("Org list-applications returns only this org's applications with correct fields", async ({
		request,
	}) => {
		const { applicationId, hubHandle } = await freshApp();
		const orgClient = new OrgAPIClient(request);
		const res = await orgClient.listApplications(orgAToken, {
			opening_id: openingAId,
		});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body!.applications)).toBe(true);

		const found = res.body!.applications.find(
			(a: { application_id: string }) => a.application_id === applicationId
		);
		expect(found).toBeDefined();
		expect(found!.state).toBe("applied");
		expect(found!.candidate_handle).toBe(hubHandle);
		expect(found!.endorsement_count).toBe(0);
		expect(found!.has_referral).toBe(false);
		expect(typeof found!.applied_at).toBe("string");
	});

	test("Org list-applications keyset pagination: limit=1 gives distinct pages", async ({
		request,
	}) => {
		// Create 3 applications to ensure at least 2 pages at limit=1
		await freshApp();
		await freshApp();
		await freshApp();

		const orgClient = new OrgAPIClient(request);
		const page1 = await orgClient.listApplications(orgAToken, {
			opening_id: openingAId,
			limit: 1,
		});
		expect(page1.status).toBe(200);
		expect(page1.body!.applications.length).toBe(1);
		expect(typeof page1.body!.next_pagination_key).toBe("string");

		const page2 = await orgClient.listApplications(orgAToken, {
			opening_id: openingAId,
			limit: 1,
			pagination_key: page1.body!.next_pagination_key,
		});
		expect(page2.status).toBe(200);
		expect(page2.body!.applications.length).toBe(1);
		expect(page1.body!.applications[0].application_id).not.toBe(
			page2.body!.applications[0].application_id
		);
	});

	// ─── Org: list-applications filters (filter_state + filter_label) ─────────────

	test("list-applications honours filter_state and filter_label", async ({
		request,
	}) => {
		const orgClient = new OrgAPIClient(request);
		// A dedicated opening so only the applications created here are listed,
		// keeping the filter assertions exact.
		const op = await createTestOpeningDirect(
			orgAId,
			orgAUserId,
			"Filter Test Opening"
		);
		async function appOn(): Promise<string> {
			const email = generateTestEmail("app-filt-hub");
			const hub = await createTestHubUserDirect(
				email,
				TEST_PASSWORD,
				"filthub"
			);
			hubEmailsToCleanup.push(email);
			return createTestApplicationDirect(
				orgAId,
				orgADomain,
				op.openingId,
				op.openingNumber,
				hub.hubUserGlobalId,
				hub.handle,
				`Filt ${hub.handle}`
			);
		}

		const green = await appOn();
		const red = await appOn();
		const plain = await appOn();
		const shortlisted = await appOn();

		expect(
			(
				await orgClient.labelApplication(orgAToken, {
					application_id: green,
					label: "green",
				})
			).status
		).toBe(200);
		expect(
			(
				await orgClient.labelApplication(orgAToken, {
					application_id: red,
					label: "red",
				})
			).status
		).toBe(200);
		expect(
			(
				await orgClient.shortlistApplication(orgAToken, {
					application_id: shortlisted,
				})
			).status
		).toBe(200);

		const ids = (r: {
			body?: { applications: { application_id: string }[] };
		}) => (r.body?.applications ?? []).map((a) => a.application_id).sort();

		// filter_state: applied → the three still-applied apps, not the shortlisted one
		const applied = await orgClient.listApplications(orgAToken, {
			opening_id: op.openingId,
			filter_state: ["applied"],
		});
		expect(applied.status).toBe(200);
		expect(ids(applied)).toEqual([green, red, plain].sort());

		// filter_state: shortlisted → only the shortlisted one
		const sl = await orgClient.listApplications(orgAToken, {
			opening_id: op.openingId,
			filter_state: ["shortlisted"],
		});
		expect(ids(sl)).toEqual([shortlisted]);

		// filter_label: green → only the green app
		const greenOnly = await orgClient.listApplications(orgAToken, {
			opening_id: op.openingId,
			filter_label: ["green"],
		});
		expect(ids(greenOnly)).toEqual([green]);

		// filter_label: green + red → both labelled apps, not the unlabelled/shortlisted
		const gr = await orgClient.listApplications(orgAToken, {
			opening_id: op.openingId,
			filter_label: ["green", "red"],
		});
		expect(ids(gr)).toEqual([green, red].sort());

		// combined filters: applied AND red → only the red app
		const combined = await orgClient.listApplications(orgAToken, {
			opening_id: op.openingId,
			filter_state: ["applied"],
			filter_label: ["red"],
		});
		expect(ids(combined)).toEqual([red]);

		// no filters → all four apps on this opening
		const all = await orgClient.listApplications(orgAToken, {
			opening_id: op.openingId,
		});
		expect(ids(all)).toEqual([green, red, plain, shortlisted].sort());
	});

	// ─── Org: get-application ─────────────────────────────────────────────────────

	test("Org get-application returns all required fields with correct values", async ({
		request,
	}) => {
		const { applicationId, hubHandle } = await freshApp();
		const orgClient = new OrgAPIClient(request);
		const res = await orgClient.getApplication(orgAToken, {
			application_id: applicationId,
		});
		expect(res.status).toBe(200);
		expect(res.body!.application_id).toBe(applicationId);
		expect(res.body!.opening_id).toBe(openingAId);
		expect(res.body!.candidate_handle).toBe(hubHandle);
		expect(res.body!.state).toBe("applied");
		expect(typeof res.body!.cover_letter).toBe("string");
		expect(res.body!.cover_letter.length).toBeGreaterThan(0);
		expect(Array.isArray(res.body!.endorsements)).toBe(true);
		expect(res.body!.endorsements).toHaveLength(0);
		expect(res.body!.notify_colleagues_used).toBe(false);
		expect(typeof res.body!.applied_at).toBe("string");
		expect(typeof res.body!.state_changed_at).toBe("string");
	});

	test("Org B cannot access Org A's application — gets 404 or 403", async ({
		request,
	}) => {
		const { applicationId } = await freshApp();
		const orgClient = new OrgAPIClient(request);
		// orgB token accessing orgA's application_id
		const res = await orgClient.getApplication(orgBToken, {
			application_id: applicationId,
		});
		expect([403, 404]).toContain(res.status);
	});

	// ─── label-application ────────────────────────────────────────────────────────

	test("label-application sets label and persists; clearing label removes it", async ({
		request,
	}) => {
		const { applicationId } = await freshApp();
		const orgClient = new OrgAPIClient(request);

		const labelRes = await orgClient.labelApplication(orgAToken, {
			application_id: applicationId,
			label: "yellow",
		});
		expect(labelRes.status).toBe(200);

		const getAfterLabel = await orgClient.getApplication(orgAToken, {
			application_id: applicationId,
		});
		expect(getAfterLabel.body!.label).toBe("yellow");

		// Clear label
		const clearRes = await orgClient.labelApplication(orgAToken, {
			application_id: applicationId,
		});
		expect(clearRes.status).toBe(200);

		const getAfterClear = await orgClient.getApplication(orgAToken, {
			application_id: applicationId,
		});
		expect(getAfterClear.body!.label).toBeUndefined();

		// Audit log contains application_id in event_data
		const auditRes = await orgClient.listAuditLogs(orgAToken, {
			event_types: ["org.label_application"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "org.label_application" &&
				e.event_data?.application_id === applicationId
		);
		expect(entry).toBeDefined();
	});

	test("label-application returns 422 when application is not in applied state", async ({
		request,
	}) => {
		const { applicationId } = await freshApp();
		const orgClient = new OrgAPIClient(request);
		// Reject first
		await orgClient.rejectApplication(orgAToken, {
			application_id: applicationId,
		});
		// Now label should be rejected
		const res = await orgClient.labelApplication(orgAToken, {
			application_id: applicationId,
			label: "green",
		});
		expect(res.status).toBe(422);
	});

	test("No audit log written when label-application fails with 401", async ({
		request,
	}) => {
		const { applicationId } = await freshApp();
		const orgClient = new OrgAPIClient(request);
		const before = await orgClient.listAuditLogs(orgAToken, {
			event_types: ["org.label_application"],
		});
		const beforeCount = before.body!.audit_logs.length;

		await request.post("/org/label-application", {
			data: { application_id: applicationId, label: "green" },
		});

		const after = await orgClient.listAuditLogs(orgAToken, {
			event_types: ["org.label_application"],
		});
		expect(after.body!.audit_logs.length).toBe(beforeCount);
	});

	// ─── reject-application ───────────────────────────────────────────────────────

	test("reject-application transitions state to rejected and writes audit log with application_id", async ({
		request,
	}) => {
		const { hubToken, applicationId } = await freshApp();
		const orgClient = new OrgAPIClient(request);
		const hubClient = new HubAPIClient(request);

		const rejectRes = await orgClient.rejectApplication(orgAToken, {
			application_id: applicationId,
			rejection_reason: "YoE below minimum requirement.",
		});
		expect(rejectRes.status).toBe(200);

		// Regional DB (org detail view) shows rejected
		const getRes = await orgClient.getApplication(orgAToken, {
			application_id: applicationId,
		});
		expect(getRes.body!.state).toBe("rejected");

		// Global index (hub list view) must also reflect rejected — not "applied"
		const listRes = await hubClient.listMyApplications(hubToken, {});
		expect(listRes.status).toBe(200);
		const listed = listRes.body!.applications.find(
			(a: { application_id: string }) => a.application_id === applicationId
		);
		expect(listed).toBeDefined();
		expect(listed!.state).toBe("rejected");

		const auditRes = await orgClient.listAuditLogs(orgAToken, {
			event_types: ["org.reject_application"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "org.reject_application" &&
				e.event_data?.application_id === applicationId
		);
		expect(entry).toBeDefined();
	});

	test("reject-application returns 422 when already rejected", async ({
		request,
	}) => {
		const { applicationId } = await freshApp();
		const orgClient = new OrgAPIClient(request);
		await orgClient.rejectApplication(orgAToken, {
			application_id: applicationId,
		});
		const res = await orgClient.rejectApplication(orgAToken, {
			application_id: applicationId,
		});
		expect(res.status).toBe(422);
	});

	// ─── shortlist-application ────────────────────────────────────────────────────

	test("shortlist-application creates candidacy — returns candidacy with correct IDs and state", async ({
		request,
	}) => {
		const { hubToken, applicationId } = await freshApp();
		const orgClient = new OrgAPIClient(request);
		const hubClient = new HubAPIClient(request);

		const res = await orgClient.shortlistApplication(orgAToken, {
			application_id: applicationId,
		});
		expect(res.status).toBe(200);
		expect(typeof res.body!.candidacy_id).toBe("string");
		expect(res.body!.application_id).toBe(applicationId);
		expect(res.body!.opening_id).toBe(openingAId);
		expect(res.body!.state).toBe("interviewing");
		expect(Array.isArray(res.body!.interviews)).toBe(true);
		expect(res.body!.interviews).toHaveLength(0);
		expect(Array.isArray(res.body!.comments)).toBe(true);
		expect(res.body!.offer).toBeUndefined();

		// Regional DB (org detail view) shows shortlisted
		const appRes = await orgClient.getApplication(orgAToken, {
			application_id: applicationId,
		});
		expect(appRes.body!.state).toBe("shortlisted");

		// Global index (hub list view) must also reflect shortlisted — not "applied"
		const hubListRes = await hubClient.listMyApplications(hubToken, {});
		expect(hubListRes.status).toBe(200);
		const listed = hubListRes.body!.applications.find(
			(a: { application_id: string }) => a.application_id === applicationId
		);
		expect(listed).toBeDefined();
		expect(listed!.state).toBe("shortlisted");

		// Candidacy appears in org candidacy list
		const listRes = await orgClient.listCandidacies(orgAToken, {});
		const found = listRes.body!.candidacies.find(
			(c: { candidacy_id: string }) => c.candidacy_id === res.body!.candidacy_id
		);
		expect(found).toBeDefined();
		expect(found!.state).toBe("interviewing");

		const auditRes = await orgClient.listAuditLogs(orgAToken, {
			event_types: ["org.shortlist_application"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "org.shortlist_application" &&
				e.event_data?.application_id === applicationId
		);
		expect(entry).toBeDefined();
	});

	test("shortlist-application returns 422 when application is already rejected", async ({
		request,
	}) => {
		const { applicationId } = await freshApp();
		const orgClient = new OrgAPIClient(request);
		await orgClient.rejectApplication(orgAToken, {
			application_id: applicationId,
		});
		const res = await orgClient.shortlistApplication(orgAToken, {
			application_id: applicationId,
		});
		expect(res.status).toBe(422);
	});

	// ─── 400 ─────────────────────────────────────────────────────────────────────

	test("list-applications: 400 when opening_id is empty", async ({
		request,
	}) => {
		const orgClient = new OrgAPIClient(request);
		const res = await orgClient.listApplications(orgAToken, { opening_id: "" });
		expect(res.status).toBe(400);
	});

	// ─── 401 unauthenticated — all use real IDs from setup ───────────────────────

	test("list-my-applications: 401 when hub user not authenticated", async ({
		request,
	}) => {
		const { applicationId } = await freshApp();
		const res = await request.post("/hub/list-my-applications", { data: {} });
		expect(res.status()).toBe(401);
	});

	test("list-applications: 401 when not authenticated", async ({ request }) => {
		const res = await request.post("/org/list-applications", {
			data: { opening_id: openingAId },
		});
		expect(res.status()).toBe(401);
	});

	test("get-application: 401 when not authenticated", async ({ request }) => {
		const { applicationId } = await freshApp();
		const res = await request.post("/org/get-application", {
			data: { application_id: applicationId },
		});
		expect(res.status()).toBe(401);
	});

	test("shortlist-application: 401 when not authenticated", async ({
		request,
	}) => {
		const { applicationId } = await freshApp();
		const res = await request.post("/org/shortlist-application", {
			data: { application_id: applicationId },
		});
		expect(res.status()).toBe(401);
	});

	test("reject-application: 401 when not authenticated", async ({
		request,
	}) => {
		const { applicationId } = await freshApp();
		const res = await request.post("/org/reject-application", {
			data: { application_id: applicationId },
		});
		expect(res.status()).toBe(401);
	});

	test("label-application: 401 when not authenticated", async ({ request }) => {
		const { applicationId } = await freshApp();
		const res = await request.post("/org/label-application", {
			data: { application_id: applicationId, label: "green" },
		});
		expect(res.status()).toBe(401);
	});
});
