import { test, expect, type APIRequestContext } from "@playwright/test";
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

test.describe("Hiring Candidacies", () => {
	test.describe.configure({ mode: "serial" });

	const { email: orgAEmail, domain: orgADomain } =
		generateTestOrgEmail("cand-orga");
	// Org B for cross-org 404/403 tests
	const { email: orgBEmail, domain: orgBDomain } =
		generateTestOrgEmail("cand-orgb");

	let orgAToken: string;
	let orgBToken: string;
	let orgAId: string;
	let orgAUserId: string;
	let orgBId: string;
	let orgBUserId: string;
	let openingAId: string;
	let openingANumber: number;

	const hubEmailsToCleanup: string[] = [];

	/**
	 * Creates a unique hub user + application + shortlists to produce a candidacy.
	 * All IDs come from API responses.
	 */
	async function freshCandidacy(request: APIRequestContext): Promise<{
		hubToken: string;
		hubHandle: string;
		applicationId: string;
		candidacyId: string;
	}> {
		const email = generateTestEmail("cand-hub");
		const hub = await createTestHubUserDirect(email, TEST_PASSWORD, "candhub");
		hubEmailsToCleanup.push(email);

		const appId = await createTestApplicationDirect(
			orgAId,
			orgADomain,
			openingAId,
			openingANumber,
			hub.hubUserGlobalId,
			hub.handle,
			`Cand ${hub.handle}`
		);

		const orgApi = new OrgAPIClient(request);
		const res = await orgApi.shortlistApplication(orgAToken, {
			application_id: appId,
		});
		expect(res.status).toBe(200);

		return {
			hubToken: hub.sessionToken,
			hubHandle: hub.handle,
			applicationId: appId,
			candidacyId: res.body.candidacy_id,
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

		const op = await createTestOpeningDirect(
			orgAId,
			orgAUserId,
			"Candidacies Opening"
		);
		openingAId = op.openingId;
		openingANumber = op.openingNumber;
	});

	test.afterAll(async () => {
		for (const email of hubEmailsToCleanup) {
			await deleteTestHubUser(email).catch(() => {});
		}
		await deleteTestGlobalOrgDomain(orgADomain);
		await deleteTestGlobalOrgDomain(orgBDomain);
	});

	// ─── Hub: list own candidacies ────────────────────────────────────────────────

	test("Hub user can list candidacies — specific candidacy with correct state", async ({
		request,
	}) => {
		const { hubToken, candidacyId } = await freshCandidacy(request);
		const hubClient = new HubAPIClient(request);
		const res = await hubClient.listMyCandidacies(hubToken, {});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body!.candidacies)).toBe(true);

		const found = res.body!.candidacies.find(
			(c: { candidacy_id: string }) => c.candidacy_id === candidacyId
		);
		expect(found).toBeDefined();
		expect(found!.state).toBe("interviewing");
	});

	// ─── Org: list-candidacies ────────────────────────────────────────────────────

	test("Org list-candidacies returns specific candidacy with correct fields", async ({
		request,
	}) => {
		const { candidacyId, applicationId } = await freshCandidacy(request);
		const orgClient = new OrgAPIClient(request);
		const res = await orgClient.listCandidacies(orgAToken, {});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body!.candidacies)).toBe(true);

		const found = res.body!.candidacies.find(
			(c: { candidacy_id: string }) => c.candidacy_id === candidacyId
		);
		expect(found).toBeDefined();
		expect(found!.state).toBe("interviewing");
		expect(found!.application_id).toBe(applicationId);
		expect(typeof found!.created_at).toBe("string");
	});

	test("Org list-candidacies keyset pagination: limit=1 returns distinct pages", async ({
		request,
	}) => {
		// Create 3 to guarantee multiple pages
		await freshCandidacy(request);
		await freshCandidacy(request);
		await freshCandidacy(request);

		const orgClient = new OrgAPIClient(request);
		const page1 = await orgClient.listCandidacies(orgAToken, { limit: 1 });
		expect(page1.status).toBe(200);
		expect(page1.body!.candidacies.length).toBe(1);
		expect(typeof page1.body!.next_pagination_key).toBe("string");

		const page2 = await orgClient.listCandidacies(orgAToken, {
			limit: 1,
			pagination_key: page1.body!.next_pagination_key,
		});
		expect(page2.status).toBe(200);
		expect(page2.body!.candidacies.length).toBe(1);
		expect(page1.body!.candidacies[0].candidacy_id).not.toBe(
			page2.body!.candidacies[0].candidacy_id
		);
	});

	// ─── Org: get-candidacy ────────────────────────────────────────────────────────

	test("Org get-candidacy returns all required fields", async ({ request }) => {
		const { candidacyId, applicationId } = await freshCandidacy(request);
		const orgClient = new OrgAPIClient(request);
		const res = await orgClient.getCandidacy(orgAToken, {
			candidacy_id: candidacyId,
		});
		expect(res.status).toBe(200);
		expect(res.body!.candidacy_id).toBe(candidacyId);
		expect(res.body!.application_id).toBe(applicationId);
		expect(res.body!.opening_id).toBe(openingAId);
		expect(res.body!.state).toBe("interviewing");
		expect(Array.isArray(res.body!.comments)).toBe(true);
		expect(Array.isArray(res.body!.interviews)).toBe(true);
		expect(res.body!.offer).toBeUndefined();
		expect(typeof res.body!.created_at).toBe("string");
		expect(typeof res.body!.state_changed_at).toBe("string");
	});

	test("Org B cannot access Org A's candidacy — gets 404 or 403", async ({
		request,
	}) => {
		const { candidacyId } = await freshCandidacy(request);
		const orgClient = new OrgAPIClient(request);
		const res = await orgClient.getCandidacy(orgBToken, {
			candidacy_id: candidacyId,
		});
		expect([403, 404]).toContain(res.status);
	});

	// ─── add-candidacy-comment ────────────────────────────────────────────────────

	test("Org adds a comment — exact body appears in get-candidacy with author_kind org_user", async ({
		request,
	}) => {
		const { candidacyId } = await freshCandidacy(request);
		const uniqueBody = `Org comment for candidacy ${candidacyId}`;
		const orgClient = new OrgAPIClient(request);

		const addRes = await orgClient.addCandidacyComment(orgAToken, {
			candidacy_id: candidacyId,
			body: uniqueBody,
		});
		expect(addRes.status).toBe(200);

		const getRes = await orgClient.getCandidacy(orgAToken, {
			candidacy_id: candidacyId,
		});
		const comment = getRes.body!.comments.find(
			(c: { body: string }) => c.body === uniqueBody
		);
		expect(comment).toBeDefined();
		expect(comment!.author_kind).toBe("org_user");
		expect(typeof comment!.comment_id).toBe("string");
		expect(typeof comment!.created_at).toBe("string");

		// Audit log has candidacy_id
		const auditRes = await orgClient.listAuditLogs(orgAToken, {
			event_types: ["org.add_candidacy_comment"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "org.add_candidacy_comment" &&
				e.event_data?.candidacy_id === candidacyId
		);
		expect(entry).toBeDefined();
	});

	test("Hub user adds a comment — exact body appears with author_kind hub_user", async ({
		request,
	}) => {
		const { hubToken, candidacyId } = await freshCandidacy(request);
		const uniqueBody = `Hub comment for candidacy ${candidacyId}`;

		const hubClient = new HubAPIClient(request);
		const addRes = await hubClient.addCandidacyComment(hubToken, {
			candidacy_id: candidacyId,
			body: uniqueBody,
		});
		expect(addRes.status).toBe(200);

		const orgClient = new OrgAPIClient(request);
		const getRes = await orgClient.getCandidacy(orgAToken, {
			candidacy_id: candidacyId,
		});
		const comment = getRes.body!.comments.find(
			(c: { body: string }) => c.body === uniqueBody
		);
		expect(comment).toBeDefined();
		expect(comment!.author_kind).toBe("hub_user");
	});

	test("Comments from both sides appear in chronological order", async ({
		request,
	}) => {
		const { hubToken, candidacyId } = await freshCandidacy(request);
		const orgClient = new OrgAPIClient(request);
		const hubClient = new HubAPIClient(request);

		const b1 = `First ${candidacyId}`;
		const b2 = `Second ${candidacyId}`;
		const b3 = `Third ${candidacyId}`;

		await orgClient.addCandidacyComment(orgAToken, {
			candidacy_id: candidacyId,
			body: b1,
		});
		await hubClient.addCandidacyComment(hubToken, {
			candidacy_id: candidacyId,
			body: b2,
		});
		await orgClient.addCandidacyComment(orgAToken, {
			candidacy_id: candidacyId,
			body: b3,
		});

		const getRes = await orgClient.getCandidacy(orgAToken, {
			candidacy_id: candidacyId,
		});
		const bodies = getRes.body!.comments.map((c: { body: string }) => c.body);
		expect(bodies.indexOf(b1)).toBeLessThan(bodies.indexOf(b2));
		expect(bodies.indexOf(b2)).toBeLessThan(bodies.indexOf(b3));
	});

	test("add-candidacy-comment: 400 when body is empty", async ({ request }) => {
		const { candidacyId } = await freshCandidacy(request);
		const orgClient = new OrgAPIClient(request);
		const res = await orgClient.addCandidacyComment(orgAToken, {
			candidacy_id: candidacyId,
			body: "",
		});
		expect(res.status).toBe(400);
	});

	test("add-candidacy-comment: 400 when body exceeds 4000 chars", async ({
		request,
	}) => {
		const { candidacyId } = await freshCandidacy(request);
		const orgClient = new OrgAPIClient(request);
		const res = await orgClient.addCandidacyComment(orgAToken, {
			candidacy_id: candidacyId,
			body: "x".repeat(4001),
		});
		expect(res.status).toBe(400);
	});

	test("Org B cannot comment on Org A's candidacy — gets 403 or 404", async ({
		request,
	}) => {
		const { candidacyId } = await freshCandidacy(request);
		const orgClient = new OrgAPIClient(request);
		const res = await orgClient.addCandidacyComment(orgBToken, {
			candidacy_id: candidacyId,
			body: "Cross-org comment attempt.",
		});
		expect([403, 404]).toContain(res.status);

		// Verify it was NOT saved
		const getRes = await orgClient.getCandidacy(orgAToken, {
			candidacy_id: candidacyId,
		});
		const blocked = getRes.body!.comments.find(
			(c: { body: string }) => c.body === "Cross-org comment attempt."
		);
		expect(blocked).toBeUndefined();
	});

	test("No audit log written when add-candidacy-comment returns 401", async ({
		request,
	}) => {
		const { candidacyId } = await freshCandidacy(request);
		const orgClient = new OrgAPIClient(request);
		const before = await orgClient.listAuditLogs(orgAToken, {
			event_types: ["org.add_candidacy_comment"],
		});
		const beforeCount = before.body!.audit_logs.length;

		await request.post("/org/add-candidacy-comment", {
			data: { candidacy_id: candidacyId, body: "unauthenticated" },
		});

		const after = await orgClient.listAuditLogs(orgAToken, {
			event_types: ["org.add_candidacy_comment"],
		});
		expect(after.body!.audit_logs.length).toBe(beforeCount);
	});

	// ─── 401 unauthenticated — use real IDs ──────────────────────────────────────

	test("list-my-candidacies: 401 when hub user not authenticated", async ({
		request,
	}) => {
		const res = await request.post("/hub/list-my-candidacies", { data: {} });
		expect(res.status()).toBe(401);
	});

	test("list-candidacies: 401 when org user not authenticated", async ({
		request,
	}) => {
		const res = await request.post("/org/list-candidacies", { data: {} });
		expect(res.status()).toBe(401);
	});

	test("get-candidacy: 401 when not authenticated", async ({ request }) => {
		const { candidacyId } = await freshCandidacy(request);
		const res = await request.post("/org/get-candidacy", {
			data: { candidacy_id: candidacyId },
		});
		expect(res.status()).toBe(401);
	});

	test("add-candidacy-comment: 401 when not authenticated", async ({
		request,
	}) => {
		const { candidacyId } = await freshCandidacy(request);
		const res = await request.post("/org/add-candidacy-comment", {
			data: { candidacy_id: candidacyId, body: "test" },
		});
		expect(res.status()).toBe(401);
	});
});
