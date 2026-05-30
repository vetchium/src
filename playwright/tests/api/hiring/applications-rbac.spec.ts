import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	createTestHubUserDirect,
	assignRoleToOrgUser,
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

test.describe("Applications RBAC", () => {
	test.describe.configure({ mode: "serial" });

	const { email: adminEmail, domain: orgDomain } =
		generateTestOrgEmail("app-rbac");
	const noRoleEmail = generateOrgUserEmail("app-rbac-norole", orgDomain);
	const viewerEmail = generateOrgUserEmail("app-rbac-viewer", orgDomain);
	const managerEmail = generateOrgUserEmail("app-rbac-mgr", orgDomain);

	let orgId: string;
	let adminToken: string;
	let noRoleToken: string;
	let viewerToken: string;
	let managerToken: string;
	let viewerUserId: string;
	let managerUserId: string;
	let orgUserId: string;
	let openingId: string;
	let openingNumber: number;

	// hub users created per-test; collected for cleanup
	const hubEmailsToCleanup: string[] = [];

	/** Creates a fresh hub user + application unique to a test. */
	async function freshApp(): Promise<{
		hubEmail: string;
		hubHandle: string;
		applicationId: string;
	}> {
		const email = generateTestEmail("app-rbac-hub");
		const hub = await createTestHubUserDirect(email, TEST_PASSWORD, "arh");
		hubEmailsToCleanup.push(email);
		const appId = await createTestApplicationDirect(
			orgId,
			orgDomain,
			openingId,
			openingNumber,
			hub.hubUserGlobalId,
			hub.handle,
			`RBAC Candidate ${hub.handle}`
		);
		return { hubEmail: email, hubHandle: hub.handle, applicationId: appId };
	}

	test.beforeAll(async ({ request }) => {
		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		orgId = adminResult.orgId;
		orgUserId = adminResult.orgUserId;
		const orgApi = new OrgAPIClient(request);
		adminToken = await loginOrgUser(orgApi, adminEmail, orgDomain);

		const noRoleResult = await createTestOrgUserDirect(
			noRoleEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain: orgDomain }
		);
		noRoleToken = await loginOrgUser(orgApi, noRoleEmail, orgDomain);

		const viewerResult = await createTestOrgUserDirect(
			viewerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain: orgDomain }
		);
		viewerUserId = viewerResult.orgUserId;
		await assignRoleToOrgUser(viewerUserId, "org:view_applications");
		viewerToken = await loginOrgUser(orgApi, viewerEmail, orgDomain);

		const managerResult = await createTestOrgUserDirect(
			managerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain: orgDomain }
		);
		managerUserId = managerResult.orgUserId;
		await assignRoleToOrgUser(managerUserId, "org:manage_applications");
		managerToken = await loginOrgUser(orgApi, managerEmail, orgDomain);

		const opening = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"RBAC Opening"
		);
		openingId = opening.openingId;
		openingNumber = opening.openingNumber;
	});

	test.afterAll(async () => {
		for (const email of hubEmailsToCleanup) {
			await deleteTestHubUser(email).catch(() => {});
		}
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	// ─── list-applications ───────────────────────────────────────────────────────

	test("list-applications: viewer (org:view_applications) gets 200 and can see the specific application", async ({
		request,
	}) => {
		const { applicationId, hubHandle } = await freshApp();
		const api = new OrgAPIClient(request);
		const res = await api.listApplications(viewerToken, {
			opening_id: openingId,
		});
		expect(res.status).toBe(200);
		const found = res.body!.applications.find(
			(a: { application_id: string }) => a.application_id === applicationId
		);
		expect(found).toBeDefined();
		expect(found!.state).toBe("applied");
		expect(found!.candidate_handle).toBe(hubHandle);
	});

	test("list-applications: no-role user gets 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.listApplications(noRoleToken, {
			opening_id: openingId,
		});
		expect(res.status).toBe(403);
	});

	test("list-applications: 401 when unauthenticated", async ({ request }) => {
		const res = await request.post("/org/list-applications", {
			data: { opening_id: openingId },
		});
		expect(res.status()).toBe(401);
	});

	// ─── get-application ─────────────────────────────────────────────────────────

	test("get-application: viewer (org:view_applications) gets 200 with full fields", async ({
		request,
	}) => {
		const { applicationId, hubHandle } = await freshApp();
		const api = new OrgAPIClient(request);
		const res = await api.getApplication(viewerToken, {
			application_id: applicationId,
		});
		expect(res.status).toBe(200);
		expect(res.body!.application_id).toBe(applicationId);
		expect(res.body!.opening_id).toBe(openingId);
		expect(res.body!.candidate_handle).toBe(hubHandle);
		expect(res.body!.state).toBe("applied");
		expect(typeof res.body!.cover_letter).toBe("string");
		expect(res.body!.cover_letter.length).toBeGreaterThan(0);
		expect(Array.isArray(res.body!.endorsements)).toBe(true);
	});

	test("get-application: no-role user gets 403", async ({ request }) => {
		const { applicationId } = await freshApp();
		const api = new OrgAPIClient(request);
		const res = await api.getApplication(noRoleToken, {
			application_id: applicationId,
		});
		expect(res.status).toBe(403);
	});

	test("get-application: 401 when unauthenticated", async ({ request }) => {
		const { applicationId } = await freshApp();
		const res = await request.post("/org/get-application", {
			data: { application_id: applicationId },
		});
		expect(res.status()).toBe(401);
	});

	// ─── label-application ───────────────────────────────────────────────────────

	test("label-application: manager (org:manage_applications) can label and audit log is written", async ({
		request,
	}) => {
		const { applicationId } = await freshApp();
		const api = new OrgAPIClient(request);

		const res = await api.labelApplication(managerToken, {
			application_id: applicationId,
			label: "red",
		});
		expect(res.status).toBe(200);

		// Verify label persisted
		const getRes = await api.getApplication(managerToken, {
			application_id: applicationId,
		});
		expect(getRes.body!.label).toBe("red");

		// Audit log contains application_id
		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.label_application"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "org.label_application" &&
				e.event_data?.application_id === applicationId
		);
		expect(entry).toBeDefined();
	});

	test("label-application: no-role user gets 403 — no audit log written", async ({
		request,
	}) => {
		const { applicationId } = await freshApp();
		const api = new OrgAPIClient(request);
		const before = await api.listAuditLogs(adminToken, {
			event_types: ["org.label_application"],
		});
		const beforeCount = before.body!.audit_logs.length;

		const res = await api.labelApplication(noRoleToken, {
			application_id: applicationId,
			label: "green",
		});
		expect(res.status).toBe(403);

		const after = await api.listAuditLogs(adminToken, {
			event_types: ["org.label_application"],
		});
		expect(after.body!.audit_logs.length).toBe(beforeCount);
	});

	test("label-application: 401 when unauthenticated", async ({ request }) => {
		const { applicationId } = await freshApp();
		const res = await request.post("/org/label-application", {
			data: { application_id: applicationId, label: "green" },
		});
		expect(res.status()).toBe(401);
	});

	// ─── reject-application ──────────────────────────────────────────────────────

	test("reject-application: manager (org:manage_applications) transitions to rejected and audit log written", async ({
		request,
	}) => {
		const { applicationId } = await freshApp();
		const api = new OrgAPIClient(request);

		const res = await api.rejectApplication(managerToken, {
			application_id: applicationId,
			rejection_reason: "Does not meet the minimum requirements.",
		});
		expect(res.status).toBe(200);

		// State is now rejected
		const getRes = await api.getApplication(viewerToken, {
			application_id: applicationId,
		});
		expect(getRes.body!.state).toBe("rejected");

		// Audit log has application_id
		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.reject_application"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "org.reject_application" &&
				e.event_data?.application_id === applicationId
		);
		expect(entry).toBeDefined();
	});

	test("reject-application: no-role user gets 403", async ({ request }) => {
		const { applicationId } = await freshApp();
		const api = new OrgAPIClient(request);
		const res = await api.rejectApplication(noRoleToken, {
			application_id: applicationId,
		});
		expect(res.status).toBe(403);
	});

	test("reject-application: 401 when unauthenticated", async ({ request }) => {
		const { applicationId } = await freshApp();
		const res = await request.post("/org/reject-application", {
			data: { application_id: applicationId },
		});
		expect(res.status()).toBe(401);
	});

	// ─── shortlist-application ────────────────────────────────────────────────────

	test("shortlist-application: manager (org:manage_applications) creates candidacy with correct fields", async ({
		request,
	}) => {
		const { applicationId, hubHandle } = await freshApp();
		const api = new OrgAPIClient(request);

		const res = await api.shortlistApplication(managerToken, {
			application_id: applicationId,
		});
		expect(res.status).toBe(200);
		expect(res.body!.candidacy_id).toBeTruthy();
		expect(res.body!.application_id).toBe(applicationId);
		expect(res.body!.opening_id).toBe(openingId);
		expect(res.body!.state).toBe("interviewing");

		// Audit log has application_id
		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.shortlist_application"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "org.shortlist_application" &&
				e.event_data?.application_id === applicationId
		);
		expect(entry).toBeDefined();
	});

	test("shortlist-application: no-role user gets 403", async ({ request }) => {
		const { applicationId } = await freshApp();
		const api = new OrgAPIClient(request);
		const res = await api.shortlistApplication(noRoleToken, {
			application_id: applicationId,
		});
		expect(res.status).toBe(403);
	});

	test("shortlist-application: 401 when unauthenticated", async ({
		request,
	}) => {
		const { applicationId } = await freshApp();
		const res = await request.post("/org/shortlist-application", {
			data: { application_id: applicationId },
		});
		expect(res.status()).toBe(401);
	});
});
