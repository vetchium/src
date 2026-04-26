import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	deleteTestGlobalOrgDomain,
	deleteTestDomainCooldown,
	generateTestDomainName,
	generateTestOrgEmail,
	assignRoleToOrgUser,
	setOrgDomainVerified,
	createTestMarketplaceListingDirect,
} from "../../../lib/db";
import { getTfaCodeFromEmail, deleteEmailsFor } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type {
	DeleteDomainRequest,
	ClaimDomainCooldownResponse,
} from "vetchium-specs/org-domains/org-domains";

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

test.describe("DELETE /org/delete-domain", () => {
	test("delete a non-primary verified domain returns 204 and audit log recorded", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("del-domain-ok");
		const secondDomain = generateTestDomainName("del-domain-2nd");

		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const token = await loginAsAdmin(api, email, domain);

			// Claim and manually verify the second domain.
			const claimRes = await api.claimDomain(token, { domain: secondDomain });
			expect(claimRes.status).toBe(201);
			await setOrgDomainVerified(secondDomain);

			const res = await api.deleteDomain(token, {
				domain: secondDomain,
			} as DeleteDomainRequest);
			expect(res.status).toBe(204);

			// Domain should no longer appear in list-domains.
			const listRes = await api.listDomains(token, {});
			expect(listRes.status).toBe(200);
			const found = listRes.body.items.find(
				(i) => i.domain === secondDomain.toLowerCase()
			);
			expect(found).toBeUndefined();

			// Audit log recorded.
			const auditRes = await api.filterAuditLogs(token, {
				event_types: ["org.delete_domain"],
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThan(0);
			const entry = auditRes.body.audit_logs[0];
			expect(entry.event_type).toBe("org.delete_domain");
		} finally {
			await deleteTestDomainCooldown(secondDomain);
			await deleteTestOrgUser(email);
		}
	});

	test("delete the only (primary) domain returns 204", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("del-only-domain");

		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const token = await loginAsAdmin(api, email, domain);

			// No other domains — deleting the primary should be allowed.
			const res = await api.deleteDomain(token, {
				domain,
			} as DeleteDomainRequest);
			expect(res.status).toBe(204);
		} finally {
			await deleteTestDomainCooldown(domain);
			await deleteTestOrgUser(email);
		}
	});

	test("delete primary domain when other domains exist returns 422", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("del-primary-422");
		const secondDomain = generateTestDomainName("del-primary-2");

		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const token = await loginAsAdmin(api, email, domain);

			const claimRes = await api.claimDomain(token, { domain: secondDomain });
			expect(claimRes.status).toBe(201);
			await setOrgDomainVerified(secondDomain);

			// Attempting to delete the primary while secondDomain exists → 422.
			const res = await api.deleteDomain(token, {
				domain,
			} as DeleteDomainRequest);
			expect(res.status).toBe(422);
		} finally {
			await deleteTestGlobalOrgDomain(secondDomain);
			await deleteTestOrgUser(email);
		}
	});

	test("delete domain with active marketplace listing returns 422", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("del-mkt-422");
		const listingDomain = generateTestDomainName("del-mkt-dom");

		try {
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const token = await loginAsAdmin(api, email, domain);

			// Claim and verify a second domain to use for the listing.
			const claimRes = await api.claimDomain(token, { domain: listingDomain });
			expect(claimRes.status).toBe(201);
			await setOrgDomainVerified(listingDomain);

			// Create an active marketplace listing using listingDomain.
			await createTestMarketplaceListingDirect(
				adminResult.orgId,
				listingDomain,
				[],
				"active"
			);

			// Deleting the domain that has an active listing should be blocked.
			const res = await api.deleteDomain(token, {
				domain: listingDomain,
			} as DeleteDomainRequest);
			expect(res.status).toBe(422);
		} finally {
			await deleteTestGlobalOrgDomain(listingDomain);
			await deleteTestOrgUser(email);
		}
	});

	test("delete non-existent domain returns 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("del-domain-404");

		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const token = await loginAsAdmin(api, email, domain);

			const res = await api.deleteDomain(token, {
				domain: generateTestDomainName("nonexistent"),
			} as DeleteDomainRequest);
			expect(res.status).toBe(404);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("delete domain owned by another org returns 404", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: email1, domain: domain1 } = generateTestOrgEmail("del-own1");
		const { email: email2, domain: domain2 } = generateTestOrgEmail("del-own2");

		try {
			await createTestOrgAdminDirect(email1, TEST_PASSWORD);
			await createTestOrgAdminDirect(email2, TEST_PASSWORD);
			const token2 = await loginAsAdmin(api, email2, domain2);

			// Org2 tries to delete org1's domain.
			const res = await api.deleteDomain(token2, {
				domain: domain1,
			} as DeleteDomainRequest);
			expect(res.status).toBe(404);
		} finally {
			await deleteTestOrgUser(email1);
			await deleteTestOrgUser(email2);
		}
	});

	test("missing domain field returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("del-domain-400");

		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const token = await loginAsAdmin(api, email, domain);
			const res = await api.deleteDomainRaw(token, {});
			expect(res.status).toBe(400);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.deleteDomainWithoutAuth({
			domain: "example.com",
		} as DeleteDomainRequest);
		expect(res.status).toBe(401);
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.deleteDomain("ind1-" + "a".repeat(64), {
			domain: "example.com",
		} as DeleteDomainRequest);
		expect(res.status).toBe(401);
	});

	test("deleted domain enters cooldown and re-claim returns 409", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("del-cooldown");
		const targetDomain = generateTestDomainName("del-cd-dom");

		try {
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const token = await loginAsAdmin(api, email, domain);

			// Claim, verify, then delete.
			const claimRes = await api.claimDomain(token, { domain: targetDomain });
			expect(claimRes.status).toBe(201);
			await setOrgDomainVerified(targetDomain);

			const delRes = await api.deleteDomain(token, {
				domain: targetDomain,
			} as DeleteDomainRequest);
			expect(delRes.status).toBe(204);

			// Attempting to re-claim the same domain immediately should return 409.
			const reclaimRes = await api.claimDomain(token, { domain: targetDomain });
			expect(reclaimRes.status).toBe(409);
			const cooldownBody =
				reclaimRes.body as unknown as ClaimDomainCooldownResponse;
			expect(cooldownBody.claimable_after).toBeDefined();
		} finally {
			await deleteTestDomainCooldown(targetDomain);
			await deleteTestOrgUser(email);
		}
	});
});

test.describe("RBAC: DELETE /org/delete-domain", () => {
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
		const generated = generateTestOrgEmail("rbac-del-adm");
		adminEmail = generated.email;
		domain = generated.domain;
		secondDomain = generateTestDomainName("rbac-del-2nd");

		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD,
			"ind1"
		);
		const adminToken = await loginAsAdmin(api, adminEmail, domain);

		// Claim and verify a second domain for the positive RBAC test.
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
		// secondDomain may have been deleted by the positive test (cooldown row created).
		await deleteTestDomainCooldown(secondDomain);
		await deleteTestGlobalOrgDomain(secondDomain);
		await deleteTestOrgUser(managerEmail);
		await deleteTestOrgUser(noRoleEmail);
		await deleteTestOrgUser(adminEmail);
	});

	test("non-superadmin WITH manage_domains can delete-domain (204)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.deleteDomain(managerToken, {
			domain: secondDomain,
		} as DeleteDomainRequest);
		expect(res.status).toBe(204);
	});

	test("org user WITHOUT role gets 403 on delete-domain", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		// secondDomain was deleted by the previous test — role check (403) fires before
		// the domain-existence check, so this still returns 403 and not 404.
		const res = await api.deleteDomain(noRoleToken, {
			domain: secondDomain,
		} as DeleteDomainRequest);
		expect(res.status).toBe(403);
	});
});
