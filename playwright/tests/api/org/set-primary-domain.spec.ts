import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	deleteTestGlobalOrgDomain,
	generateTestDomainName,
	generateTestOrgEmail,
	assignRoleToOrgUser,
	setOrgDomainVerified,
} from "../../../lib/db";
import { getTfaCodeFromEmail, deleteEmailsFor } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type { SetPrimaryDomainRequest } from "vetchium-specs/org-domains/org-domains";

async function loginAsAdmin(
	api: OrgAPIClient,
	email: string,
	domain: string
): Promise<string> {
	await deleteEmailsFor(email);
	const loginRes = await api.login({
		email,
		domain,
		password: TEST_PASSWORD,
	} as OrgLoginRequest);
	expect(loginRes.status).toBe(200);
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaRes = await api.verifyTFA({
		tfa_token: loginRes.body.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	} as OrgTFARequest);
	expect(tfaRes.status).toBe(200);
	return tfaRes.body.session_token;
}

test.describe("POST /org/set-primary-domain", () => {
	test("set a verified non-primary domain as primary returns 200 and audit log recorded", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("set-primary-ok");
		const secondDomain = generateTestDomainName("set-primary-2nd");

		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const token = await loginAsAdmin(api, email, domain);

			// Claim and manually verify the second domain.
			const claimRes = await api.claimDomain(token, { domain: secondDomain });
			expect(claimRes.status).toBe(201);
			await setOrgDomainVerified(secondDomain);

			const req: SetPrimaryDomainRequest = { domain: secondDomain };
			const res = await api.setPrimaryDomain(token, req);
			expect(res.status).toBe(200);

			// Confirm is_primary changed in list-domains.
			const listRes = await api.listDomains(token, {});
			expect(listRes.status).toBe(200);
			const secondItem = listRes.body.items.find(
				(i) => i.domain === secondDomain.toLowerCase()
			);
			expect(secondItem?.is_primary).toBe(true);
			const firstItem = listRes.body.items.find(
				(i) => i.domain === domain.toLowerCase()
			);
			expect(firstItem?.is_primary).toBe(false);

			// Audit log recorded.
			const auditRes = await api.filterAuditLogs(token, {
				event_types: ["org.set_primary_domain"],
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThan(0);
			const entry = auditRes.body.audit_logs[0];
			expect(entry.event_type).toBe("org.set_primary_domain");
		} finally {
			await deleteTestGlobalOrgDomain(secondDomain);
			await deleteTestOrgUser(email);
		}
	});

	test("set PENDING domain as primary returns 422", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("set-primary-pending");
		const pendingDomain = generateTestDomainName("set-primary-pnd");

		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const token = await loginAsAdmin(api, email, domain);

			const claimRes = await api.claimDomain(token, { domain: pendingDomain });
			expect(claimRes.status).toBe(201);

			const res = await api.setPrimaryDomain(token, { domain: pendingDomain });
			expect(res.status).toBe(422);
		} finally {
			await deleteTestGlobalOrgDomain(pendingDomain);
			await deleteTestOrgUser(email);
		}
	});

	test("set non-existent domain as primary returns 404", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("set-primary-404");

		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const token = await loginAsAdmin(api, email, domain);

			const res = await api.setPrimaryDomain(token, {
				domain: generateTestDomainName("nonexistent"),
			});
			expect(res.status).toBe(404);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("domain owned by another org returns 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: email1, domain: domain1 } =
			generateTestOrgEmail("set-primary-own1");
		const { email: email2, domain: domain2 } =
			generateTestOrgEmail("set-primary-own2");

		try {
			await createTestOrgAdminDirect(email1, TEST_PASSWORD);
			await createTestOrgAdminDirect(email2, TEST_PASSWORD);
			const token2 = await loginAsAdmin(api, email2, domain2);

			// email2 tries to set domain1 (owned by org1) as primary — should 404.
			const res = await api.setPrimaryDomain(token2, { domain: domain1 });
			expect(res.status).toBe(404);
		} finally {
			await deleteTestOrgUser(email1);
			await deleteTestOrgUser(email2);
		}
	});

	test("missing domain returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("set-primary-400");

		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const token = await loginAsAdmin(api, email, domain);
			const res = await api.setPrimaryDomainRaw(token, {});
			expect(res.status).toBe(400);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.setPrimaryDomainWithoutAuth({
			domain: "example.com",
		});
		expect(res.status).toBe(401);
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.setPrimaryDomain("ind1-" + "a".repeat(64), {
			domain: "example.com",
		});
		expect(res.status).toBe(401);
	});
});

test.describe("RBAC: POST /org/set-primary-domain", () => {
	test.describe.configure({ mode: "serial" });

	let adminEmail: string;
	let managerEmail: string;
	let noRoleEmail: string;
	let domain: string;
	let secondDomain: string;
	let managerToken: string;
	let noRoleToken: string;

	test.beforeAll(async ({ request }) => {
		const api = new OrgAPIClient(request);
		const generated = generateTestOrgEmail("rbac-spd-adm");
		adminEmail = generated.email;
		domain = generated.domain;
		secondDomain = generateTestDomainName("rbac-spd-2nd");

		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD,
			"ind1"
		);
		const adminToken = await loginAsAdmin(api, adminEmail, domain);

		await api.claimDomain(adminToken, { domain: secondDomain });
		await setOrgDomainVerified(secondDomain);

		managerEmail = `manager@${domain}`;
		const managerResult = await createTestOrgUserDirect(
			managerEmail,
			TEST_PASSWORD,
			"ind1",
			{
				orgId: adminResult.orgId,
				domain,
			}
		);
		await assignRoleToOrgUser(managerResult.orgUserId, "org:manage_domains");
		managerToken = await loginAsAdmin(api, managerEmail, domain);

		noRoleEmail = `norole@${domain}`;
		await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
			orgId: adminResult.orgId,
			domain,
		});
		noRoleToken = await loginAsAdmin(api, noRoleEmail, domain);
	});

	test.afterAll(async () => {
		await deleteTestGlobalOrgDomain(secondDomain);
		await deleteTestOrgUser(managerEmail);
		await deleteTestOrgUser(noRoleEmail);
		await deleteTestOrgUser(adminEmail);
	});

	test("non-superadmin WITH manage_domains can set-primary-domain (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.setPrimaryDomain(managerToken, {
			domain: secondDomain,
		});
		expect(res.status).toBe(200);
	});

	test("org user WITHOUT role gets 403 on set-primary-domain", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.setPrimaryDomain(noRoleToken, {
			domain: secondDomain,
		});
		expect(res.status).toBe(403);
	});
});
