import { test, expect, type APIRequestContext } from "@playwright/test";
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

test.describe("Candidacies RBAC", () => {
	test.describe.configure({ mode: "serial" });

	const { email: adminEmail, domain: orgDomain } =
		generateTestOrgEmail("cand-rbac");
	const noRoleEmail = generateOrgUserEmail("crb-norole", orgDomain);
	const viewerEmail = generateOrgUserEmail("crb-viewer", orgDomain);
	const managerEmail = generateOrgUserEmail("crb-mgr", orgDomain);

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

	const hubEmailsToCleanup: string[] = [];

	/**
	 * Creates a unique hub user + application, shortlists it via admin to produce
	 * a candidacy. All IDs come from API responses. Requires a Playwright `request`.
	 */
	async function makeCandidacy(
		request: APIRequestContext
	): Promise<{ candidacyId: string; applicationId: string }> {
		const email = generateTestEmail("crb-hub");
		const hub = await createTestHubUserDirect(email, TEST_PASSWORD, "crbhub");
		hubEmailsToCleanup.push(email);
		const appId = await createTestApplicationDirect(
			orgId,
			orgDomain,
			openingId,
			openingNumber,
			hub.hubUserGlobalId,
			hub.handle,
			`RBAC Cand ${hub.handle}`
		);
		const orgApi = new OrgAPIClient(request);
		const res = await orgApi.shortlistApplication(adminToken, {
			application_id: appId,
		});
		expect(res.status).toBe(200);
		return { candidacyId: res.body.candidacy_id, applicationId: appId };
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

		await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
			orgId,
			domain: orgDomain,
		});
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
		await assignRoleToOrgUser(managerUserId, "org:manage_candidacies");
		managerToken = await loginOrgUser(orgApi, managerEmail, orgDomain);

		const opening = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"Cand RBAC Opening"
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

	// ─── list-candidacies ─────────────────────────────────────────────────────────

	test("list-candidacies: viewer (org:view_applications) gets 200 — specific candidacy appears", async ({
		request,
	}) => {
		const { candidacyId, applicationId } = await makeCandidacy(request);
		const api = new OrgAPIClient(request);
		const res = await api.listCandidacies(viewerToken, {});
		expect(res.status).toBe(200);
		const found = res.body!.candidacies.find(
			(c: { candidacy_id: string }) => c.candidacy_id === candidacyId
		);
		expect(found).toBeDefined();
		expect(found!.state).toBe("interviewing");
		expect(found!.application_id).toBe(applicationId);
	});

	test("list-candidacies: no-role user gets 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.listCandidacies(noRoleToken, {});
		expect(res.status).toBe(403);
	});

	test("list-candidacies: 401 when unauthenticated", async ({ request }) => {
		const res = await request.post("/org/list-candidacies", { data: {} });
		expect(res.status()).toBe(401);
	});

	// ─── get-candidacy ────────────────────────────────────────────────────────────

	test("get-candidacy: viewer (org:view_applications) gets 200 with full fields", async ({
		request,
	}) => {
		const { candidacyId, applicationId } = await makeCandidacy(request);
		const api = new OrgAPIClient(request);
		const res = await api.getCandidacy(viewerToken, {
			candidacy_id: candidacyId,
		});
		expect(res.status).toBe(200);
		expect(res.body!.candidacy_id).toBe(candidacyId);
		expect(res.body!.application_id).toBe(applicationId);
		expect(res.body!.opening_id).toBe(openingId);
		expect(res.body!.state).toBe("interviewing");
		expect(Array.isArray(res.body!.comments)).toBe(true);
		expect(Array.isArray(res.body!.interviews)).toBe(true);
	});

	test("get-candidacy: no-role user gets 403", async ({ request }) => {
		const { candidacyId } = await makeCandidacy(request);
		const api = new OrgAPIClient(request);
		const res = await api.getCandidacy(noRoleToken, {
			candidacy_id: candidacyId,
		});
		expect(res.status).toBe(403);
	});

	test("get-candidacy: 401 when unauthenticated", async ({ request }) => {
		const { candidacyId } = await makeCandidacy(request);
		const res = await request.post("/org/get-candidacy", {
			data: { candidacy_id: candidacyId },
		});
		expect(res.status()).toBe(401);
	});

	// ─── add-candidacy-comment ────────────────────────────────────────────────────

	test("add-candidacy-comment: manager (org:manage_candidacies) gets 200 — comment appears in detail", async ({
		request,
	}) => {
		const { candidacyId } = await makeCandidacy(request);
		const uniqueBody = `Manager RBAC comment ${candidacyId}`;
		const api = new OrgAPIClient(request);

		const res = await api.addCandidacyComment(managerToken, {
			candidacy_id: candidacyId,
			body: uniqueBody,
		});
		expect(res.status).toBe(200);

		const getRes = await api.getCandidacy(viewerToken, {
			candidacy_id: candidacyId,
		});
		const comment = getRes.body!.comments.find(
			(c: { body: string }) => c.body === uniqueBody
		);
		expect(comment).toBeDefined();
		expect(comment!.author_kind).toBe("org_user");

		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.add_candidacy_comment"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "org.add_candidacy_comment" &&
				e.event_data?.candidacy_id === candidacyId
		);
		expect(entry).toBeDefined();
	});

	test("add-candidacy-comment: no-role user gets 403 — comment not saved", async ({
		request,
	}) => {
		const { candidacyId } = await makeCandidacy(request);
		const api = new OrgAPIClient(request);

		const res = await api.addCandidacyComment(noRoleToken, {
			candidacy_id: candidacyId,
			body: "This should be blocked by role check.",
		});
		expect(res.status).toBe(403);

		const getRes = await api.getCandidacy(viewerToken, {
			candidacy_id: candidacyId,
		});
		const blocked = getRes.body!.comments.find(
			(c: { body: string }) =>
				c.body === "This should be blocked by role check."
		);
		expect(blocked).toBeUndefined();
	});

	test("add-candidacy-comment: 401 when unauthenticated", async ({
		request,
	}) => {
		const { candidacyId } = await makeCandidacy(request);
		const res = await request.post("/org/add-candidacy-comment", {
			data: { candidacy_id: candidacyId, body: "unauthenticated attempt" },
		});
		expect(res.status()).toBe(401);
	});
});
