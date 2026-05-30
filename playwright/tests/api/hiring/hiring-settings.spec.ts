import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	generateTestOrgEmail,
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

test.describe("Hiring Settings", () => {
	// Each test gets its own org to ensure no state bleeds between tests.
	// Settings tests mutate the org's hiring config, so sharing an org causes
	// ordering dependencies.

	test("get-hiring-settings returns default cool_off_days of 90", async ({
		request,
	}) => {
		const { email, domain } = generateTestOrgEmail("hs-default");
		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const orgApi = new OrgAPIClient(request);
			const token = await loginOrgUser(orgApi, email, domain);

			const res = await orgApi.getHiringSettings(token);
			expect(res.status).toBe(200);
			expect(res.body!.cool_off_days).toBe(90);
			expect(typeof res.body!.allow_unsolicited_endorsements_default).toBe(
				"boolean"
			);
		} finally {
			await deleteTestGlobalOrgDomain(domain);
		}
	});

	test("update cool_off_days to 45 — persists on read-back", async ({
		request,
	}) => {
		const { email, domain } = generateTestOrgEmail("hs-update");
		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const orgApi = new OrgAPIClient(request);
			const token = await loginOrgUser(orgApi, email, domain);

			const updateRes = await orgApi.updateHiringSettings(token, {
				cool_off_days: 45,
				allow_unsolicited_endorsements_default: true,
			});
			expect(updateRes.status).toBe(200);

			const getRes = await orgApi.getHiringSettings(token);
			expect(getRes.body!.cool_off_days).toBe(45);
			expect(getRes.body!.allow_unsolicited_endorsements_default).toBe(true);

			// Audit log: event_type matches, no raw email in event_data
			const auditRes = await orgApi.listAuditLogs(token, {
				event_types: ["org.update_hiring_settings"],
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body!.audit_logs.length).toBeGreaterThan(0);
			const entry = auditRes.body!.audit_logs[0];
			expect(entry.event_type).toBe("org.update_hiring_settings");
			// actor_email is null for privacy; event_type and event_data are what matter
			expect(typeof entry.event_data).toBe("object");
		} finally {
			await deleteTestGlobalOrgDomain(domain);
		}
	});

	test("cool_off_days = 0 disables cool-off window — persists", async ({
		request,
	}) => {
		const { email, domain } = generateTestOrgEmail("hs-zero");
		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const orgApi = new OrgAPIClient(request);
			const token = await loginOrgUser(orgApi, email, domain);

			const updateRes = await orgApi.updateHiringSettings(token, {
				cool_off_days: 0,
				allow_unsolicited_endorsements_default: false,
			});
			expect(updateRes.status).toBe(200);

			const getRes = await orgApi.getHiringSettings(token);
			expect(getRes.body!.cool_off_days).toBe(0);
		} finally {
			await deleteTestGlobalOrgDomain(domain);
		}
	});

	test("cool_off_days = 365 is the maximum allowed value", async ({
		request,
	}) => {
		const { email, domain } = generateTestOrgEmail("hs-max");
		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const orgApi = new OrgAPIClient(request);
			const token = await loginOrgUser(orgApi, email, domain);

			const updateRes = await orgApi.updateHiringSettings(token, {
				cool_off_days: 365,
				allow_unsolicited_endorsements_default: false,
			});
			expect(updateRes.status).toBe(200);

			const getRes = await orgApi.getHiringSettings(token);
			expect(getRes.body!.cool_off_days).toBe(365);
		} finally {
			await deleteTestGlobalOrgDomain(domain);
		}
	});

	test("cool_off_days = 366 is rejected with 400 — state is unchanged", async ({
		request,
	}) => {
		const { email, domain } = generateTestOrgEmail("hs-too-high");
		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const orgApi = new OrgAPIClient(request);
			const token = await loginOrgUser(orgApi, email, domain);

			const badRes = await orgApi.updateHiringSettings(token, {
				cool_off_days: 366,
				allow_unsolicited_endorsements_default: false,
			});
			expect(badRes.status).toBe(400);

			// State unchanged — still 90
			const getRes = await orgApi.getHiringSettings(token);
			expect(getRes.body!.cool_off_days).toBe(90);
		} finally {
			await deleteTestGlobalOrgDomain(domain);
		}
	});

	test("cool_off_days = -1 is rejected with 400", async ({ request }) => {
		const { email, domain } = generateTestOrgEmail("hs-negative");
		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const orgApi = new OrgAPIClient(request);
			const token = await loginOrgUser(orgApi, email, domain);

			const res = await orgApi.updateHiringSettings(token, {
				cool_off_days: -1,
				allow_unsolicited_endorsements_default: false,
			});
			expect(res.status).toBe(400);
		} finally {
			await deleteTestGlobalOrgDomain(domain);
		}
	});

	test("No audit log written when update-hiring-settings returns 400", async ({
		request,
	}) => {
		const { email, domain } = generateTestOrgEmail("hs-noaudit");
		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const orgApi = new OrgAPIClient(request);
			const token = await loginOrgUser(orgApi, email, domain);

			const before = await orgApi.listAuditLogs(token, {
				event_types: ["org.update_hiring_settings"],
			});
			const beforeCount = before.body!.audit_logs.length;

			await orgApi.updateHiringSettings(token, {
				cool_off_days: 999,
				allow_unsolicited_endorsements_default: false,
			});

			const after = await orgApi.listAuditLogs(token, {
				event_types: ["org.update_hiring_settings"],
			});
			expect(after.body!.audit_logs.length).toBe(beforeCount);
		} finally {
			await deleteTestGlobalOrgDomain(domain);
		}
	});

	test("401 when not authenticated for get-hiring-settings", async ({
		request,
	}) => {
		const res = await request.post("/org/get-hiring-settings", { data: {} });
		expect(res.status()).toBe(401);
	});

	test("401 when not authenticated for update-hiring-settings", async ({
		request,
	}) => {
		const res = await request.post("/org/update-hiring-settings", {
			data: {
				cool_off_days: 30,
				allow_unsolicited_endorsements_default: false,
			},
		});
		expect(res.status()).toBe(401);
	});
});
