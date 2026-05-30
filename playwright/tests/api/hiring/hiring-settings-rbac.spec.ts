import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	assignRoleToOrgUser,
	generateTestOrgEmail,
	generateOrgUserEmail,
	deleteTestGlobalOrgDomain,
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

test.describe("Hiring Settings RBAC", () => {
	test.describe.configure({ mode: "serial" });

	const { email: adminEmail, domain: orgDomain } =
		generateTestOrgEmail("hs-rbac-admin");
	const noRoleEmail = generateOrgUserEmail("hs-rbac-norole", orgDomain);
	const viewerEmail = generateOrgUserEmail("hs-rbac-viewer", orgDomain);
	const managerEmail = generateOrgUserEmail("hs-rbac-mgr", orgDomain);

	let orgId: string;
	let adminToken: string;
	let noRoleToken: string;
	let viewerToken: string;
	let managerToken: string;
	let viewerUserId: string;
	let managerUserId: string;

	test.beforeAll(async ({ request }) => {
		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		orgId = adminResult.orgId;
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
		await assignRoleToOrgUser(viewerUserId, "org:view_hiring_settings");
		viewerToken = await loginOrgUser(orgApi, viewerEmail, orgDomain);

		const managerResult = await createTestOrgUserDirect(
			managerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain: orgDomain }
		);
		managerUserId = managerResult.orgUserId;
		await assignRoleToOrgUser(managerUserId, "org:manage_hiring_settings");
		managerToken = await loginOrgUser(orgApi, managerEmail, orgDomain);
	});

	test.afterAll(async () => {
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	// ─── get-hiring-settings RBAC ─────────────────────────────────────────────────

	test("get-hiring-settings: viewer with org:view_hiring_settings → 200", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.getHiringSettings(viewerToken);
		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty("cool_off_days");
	});

	test("get-hiring-settings: no-role user → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.getHiringSettings(noRoleToken);
		expect(res.status).toBe(403);
	});

	// ─── update-hiring-settings RBAC ──────────────────────────────────────────────

	test("update-hiring-settings: manager with org:manage_hiring_settings → 200", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.updateHiringSettings(managerToken, {
			cool_off_days: 45,
			allow_unsolicited_endorsements_default: false,
		});
		expect(res.status).toBe(200);

		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.update_hiring_settings"],
		});
		const entry = auditRes.body?.audit_logs?.find(
			(e: { event_type: string }) =>
				e.event_type === "org.update_hiring_settings"
		);
		expect(entry).toBeDefined();
	});

	test("update-hiring-settings: viewer with only view role → 403", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.updateHiringSettings(viewerToken, {
			cool_off_days: 30,
			allow_unsolicited_endorsements_default: false,
		});
		expect(res.status).toBe(403);
	});

	test("update-hiring-settings: no-role user → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.updateHiringSettings(noRoleToken, {
			cool_off_days: 30,
			allow_unsolicited_endorsements_default: false,
		});
		expect(res.status).toBe(403);
	});

	// ─── 401 unauthenticated ──────────────────────────────────────────────────────

	test("get-hiring-settings: 401 unauthenticated", async ({ request }) => {
		const res = await request.post("/org/get-hiring-settings", { data: {} });
		expect(res.status()).toBe(401);
	});

	test("update-hiring-settings: 401 unauthenticated", async ({ request }) => {
		const res = await request.post("/org/update-hiring-settings", {
			data: {
				cool_off_days: 30,
				allow_unsolicited_endorsements_default: false,
			},
		});
		expect(res.status()).toBe(401);
	});
});
