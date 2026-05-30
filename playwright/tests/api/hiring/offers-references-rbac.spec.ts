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

test.describe("Offers and References RBAC", () => {
	test.describe.configure({ mode: "serial" });

	const { email: adminEmail, domain: orgDomain } =
		generateTestOrgEmail("ofrref-rbac");
	const noRoleEmail = generateOrgUserEmail("ofrref-norole", orgDomain);
	const managerEmail = generateOrgUserEmail("ofrref-mgr", orgDomain);
	const viewerEmail = generateOrgUserEmail("ofrref-viewer", orgDomain);
	const hubEmail = generateTestEmail("ofrref-hub");

	let orgId: string;
	let adminToken: string;
	let noRoleToken: string;
	let managerToken: string;
	let viewerToken: string;
	let adminUserId: string;
	let managerUserId: string;
	let viewerUserId: string;
	let hubUserGlobalId: string;
	let hubHandle: string;
	let openingId: string;
	let openingNumber: number;
	let candidacyId: string;
	let requestId: string;
	const hubEmailsToCleanup: string[] = [];

	test.beforeAll(async ({ request }) => {
		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		orgId = adminResult.orgId;
		adminUserId = adminResult.orgUserId;
		const orgApi = new OrgAPIClient(request);
		adminToken = await loginOrgUser(orgApi, adminEmail, orgDomain);

		await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
			orgId,
			domain: orgDomain,
		});
		noRoleToken = await loginOrgUser(orgApi, noRoleEmail, orgDomain);

		const managerResult = await createTestOrgUserDirect(
			managerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain: orgDomain }
		);
		managerUserId = managerResult.orgUserId;
		await assignRoleToOrgUser(managerUserId, "org:manage_candidacies");
		managerToken = await loginOrgUser(orgApi, managerEmail, orgDomain);

		const viewerResult = await createTestOrgUserDirect(
			viewerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain: orgDomain }
		);
		viewerUserId = viewerResult.orgUserId;
		await assignRoleToOrgUser(viewerUserId, "org:view_candidacies");
		viewerToken = await loginOrgUser(orgApi, viewerEmail, orgDomain);

		const hubResult = await createTestHubUserDirect(
			hubEmail,
			TEST_PASSWORD,
			"ofrref-hub"
		);
		hubUserGlobalId = hubResult.hubUserGlobalId;
		hubHandle = hubResult.handle;

		const openingResult = await createTestOpeningDirect(
			orgId,
			adminUserId,
			"Offers References RBAC"
		);
		openingId = openingResult.openingId;
		openingNumber = openingResult.openingNumber;
		const appId = await createTestApplicationDirect(
			orgId,
			orgDomain,
			openingId,
			openingNumber,
			hubUserGlobalId,
			hubHandle,
			"Offers References Candidate"
		);

		const shortlistRes = await orgApi.shortlistApplication(adminToken, {
			application_id: appId,
		});
		expect(shortlistRes.status).toBe(200);
		candidacyId = shortlistRes.body.candidacy_id;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(hubEmail);
		for (const email of hubEmailsToCleanup) {
			await deleteTestHubUser(email).catch(() => {});
		}
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	// ─── request-references RBAC ──────────────────────────────────────────────────
	// Positive test runs FIRST so requestId is set for all subsequent tests.

	test("request-references: manager with org:manage_candidacies → 201 with real request_id", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.requestReferences(managerToken, {
			candidacy_id: candidacyId,
			max_references: 2,
			response_deadline: "2027-12-31",
			questions: [
				{
					question_id: "q1",
					text: "How long did you work together and in what capacity?",
					min_chars: 10,
					max_chars: 1000,
					required: true,
				},
			],
		});
		expect(res.status).toBe(201);
		expect(typeof res.body.request_id).toBe("string");
		requestId = res.body.request_id;

		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.request_references"],
		});
		const entry = auditRes.body?.audit_logs?.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "org.request_references" &&
				e.event_data?.candidacy_id === candidacyId
		);
		expect(entry).toBeDefined();
	});

	test("request-references: no-role user → 403", async ({ request }) => {
		// Creates its own fresh candidacy so no-role test is independent
		const candidacyForNoRole = await (async () => {
			const email = generateTestEmail("orf-norole-hub");
			const hub = await createTestHubUserDirect(email, TEST_PASSWORD, "orfnr");
			hubEmailsToCleanup.push(email);
			const appId = await createTestApplicationDirect(
				orgId,
				orgDomain,
				openingId,
				openingNumber,
				hub.hubUserGlobalId,
				hub.handle,
				`NoRole Ref Cand`
			);
			const orgApi = new OrgAPIClient(request);
			const sr = await orgApi.shortlistApplication(adminToken, {
				application_id: appId,
			});
			return sr.body.candidacy_id as string;
		})();

		const api = new OrgAPIClient(request);
		const res = await api.requestReferences(noRoleToken, {
			candidacy_id: candidacyForNoRole,
			max_references: 1,
			response_deadline: "2027-12-31",
			questions: [
				{
					question_id: "q1",
					text: "How long did you work together and in what capacity?",
					min_chars: 10,
					max_chars: 1000,
					required: true,
				},
			],
		});
		expect(res.status).toBe(403);
	});

	// ─── list-reference-nominations RBAC ─────────────────────────────────────────

	test("list-reference-nominations: manager with org:manage_candidacies → 200 with correct fields", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.listReferenceNominations(managerToken, {
			request_id: requestId,
		});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body!.nominations)).toBe(true);
	});

	test("list-reference-nominations: viewer with org:view_candidacies → 200", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.listReferenceNominations(viewerToken, {
			request_id: requestId,
		});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body!.nominations)).toBe(true);
	});

	test("list-reference-nominations: no-role user → 403", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.listReferenceNominations(noRoleToken, {
			request_id: requestId,
		});
		expect(res.status).toBe(403);
	});

	// ─── list-reference-responses RBAC ────────────────────────────────────────────

	test("list-reference-responses: viewer with org:view_candidacies → 200 with correct fields", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.listReferenceResponses(viewerToken, {
			request_id: requestId,
		});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body!.responses)).toBe(true);
		expect(Array.isArray(res.body!.declined_nominations)).toBe(true);
	});

	test("list-reference-responses: no-role user → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.listReferenceResponses(noRoleToken, {
			request_id: requestId,
		});
		expect(res.status).toBe(403);
	});

	// ─── 401 unauthenticated — use real IDs ──────────────────────────────────────

	test("request-references: 401 unauthenticated", async ({ request }) => {
		const res = await request.post("/org/request-references", {
			data: {
				candidacy_id: candidacyId,
				max_references: 1,
				response_deadline: "2027-12-31",
				questions: [
					{
						question_id: "q1",
						text: "Tell me about them in detail.",
						min_chars: 10,
						max_chars: 500,
						required: true,
					},
				],
			},
		});
		expect(res.status()).toBe(401);
	});

	test("list-reference-nominations: 401 unauthenticated", async ({
		request,
	}) => {
		const res = await request.post("/org/list-reference-nominations", {
			data: { request_id: requestId },
		});
		expect(res.status()).toBe(401);
	});

	test("list-reference-responses: 401 unauthenticated", async ({ request }) => {
		const res = await request.post("/org/list-reference-responses", {
			data: { request_id: requestId },
		});
		expect(res.status()).toBe(401);
	});
});
