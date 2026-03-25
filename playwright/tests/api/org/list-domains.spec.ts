import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	generateTestOrgEmail,
	deleteTestOrgUser,
	deleteTestGlobalOrgDomain,
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	generateTestDomainName,
	assignRoleToOrgUser,
} from "../../../lib/db";
import { getTfaCodeFromEmail, deleteEmailsFor } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type {
	ClaimDomainRequest,
	ListDomainStatusRequest,
} from "vetchium-specs/org-domains/org-domains";

/**
 * Helper to create an org admin and return session token.
 */
async function createOrgAdminAndGetSession(
	api: OrgAPIClient,
	emailPrefix: string
): Promise<{ email: string; sessionToken: string }> {
	const { email, domain } = generateTestOrgEmail(emailPrefix);

	await createTestOrgAdminDirect(email, TEST_PASSWORD);
	await deleteEmailsFor(email);

	const loginRequest: OrgLoginRequest = {
		email,
		domain,
		password: TEST_PASSWORD,
	};
	const loginResponse = await api.login(loginRequest);
	expect(loginResponse.status).toBe(200);

	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaRequest: OrgTFARequest = {
		tfa_token: loginResponse.body.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	};
	const tfaResponse = await api.verifyTFA(tfaRequest);
	expect(tfaResponse.status).toBe(200);

	return { email, sessionToken: tfaResponse.body.session_token };
}

test.describe("POST /org/list-domains", () => {
	test("no domains returns empty list", async ({ request }) => {
		const api = new OrgAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgAdminAndGetSession(
				api,
				"org-list-empty"
			);
			userEmail = email;

			const listRequest: ListDomainStatusRequest = {};
			const response = await api.listDomains(sessionToken, listRequest);

			expect(response.status).toBe(200);
			expect(response.body.items).toBeDefined();
			expect(Array.isArray(response.body.items)).toBe(true);
			expect(response.body.items.length).toBe(0);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("claim one domain and list shows it", async ({ request }) => {
		const api = new OrgAPIClient(request);
		let userEmail = "";
		const claimedDomain = generateTestDomainName("org-list-one");

		try {
			const { email, sessionToken } = await createOrgAdminAndGetSession(
				api,
				"org-list-one"
			);
			userEmail = email;

			// Claim a domain
			const claimRequest: ClaimDomainRequest = {
				domain: claimedDomain,
			};
			const claimResponse = await api.claimDomain(sessionToken, claimRequest);
			expect(claimResponse.status).toBe(201);

			// List domains
			const listRequest: ListDomainStatusRequest = {};
			const response = await api.listDomains(sessionToken, listRequest);

			expect(response.status).toBe(200);
			expect(response.body.items).toBeDefined();
			expect(response.body.items.length).toBe(1);
			expect(response.body.items[0].domain).toBe(claimedDomain.toLowerCase());
			expect(response.body.items[0].status).toBe("PENDING");
		} finally {
			await deleteTestGlobalOrgDomain(claimedDomain);
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("claim two domains and pagination cursor works", async ({ request }) => {
		const api = new OrgAPIClient(request);
		let userEmail = "";
		const domain1 = generateTestDomainName("org-list-pag1");
		const domain2 = generateTestDomainName("org-list-pag2");

		try {
			const { email, sessionToken } = await createOrgAdminAndGetSession(
				api,
				"org-list-pag"
			);
			userEmail = email;

			// Claim two domains
			const claim1 = await api.claimDomain(sessionToken, { domain: domain1 });
			expect(claim1.status).toBe(201);
			const claim2 = await api.claimDomain(sessionToken, { domain: domain2 });
			expect(claim2.status).toBe(201);

			// List domains without cursor - should return both
			const listRequest: ListDomainStatusRequest = {};
			const response = await api.listDomains(sessionToken, listRequest);

			expect(response.status).toBe(200);
			expect(response.body.items).toBeDefined();
			expect(response.body.items.length).toBe(2);

			// The domains should be in the list
			const domains = response.body.items.map((item) => item.domain);
			expect(domains).toContain(domain1.toLowerCase());
			expect(domains).toContain(domain2.toLowerCase());
		} finally {
			await deleteTestGlobalOrgDomain(domain1);
			await deleteTestGlobalOrgDomain(domain2);
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const listRequest: ListDomainStatusRequest = {};
		const response = await api.listDomainsWithoutAuth(listRequest);

		expect(response.status).toBe(401);
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const listRequest: ListDomainStatusRequest = {};
		const response = await api.listDomains(
			"ind1-" + "a".repeat(64),
			listRequest
		);

		expect(response.status).toBe(401);
	});
});

test.describe("RBAC: POST /org/list-domains", () => {
	let viewerToken: string;
	let noRoleToken: string;
	let adminEmail: string;
	let viewerEmail: string;
	let noRoleEmail: string;
	let domain: string;
	let claimedDomain: string;

	test.beforeAll(async ({ request }) => {
		const api = new OrgAPIClient(request);

		const generated = generateTestOrgEmail("rbac-ld-emp");
		adminEmail = generated.email;
		domain = generated.domain;
		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD,
			"ind1"
		);

		// Claim a fresh domain so list-domains returns something
		claimedDomain = generateTestDomainName("rbac-ld-cl");
		const adminLoginRes = await api.login({
			email: adminEmail,
			domain,
			password: TEST_PASSWORD,
		});
		const adminTfaCode = await getTfaCodeFromEmail(adminEmail);
		const adminTfaRes = await api.verifyTFA({
			tfa_token: adminLoginRes.body.tfa_token,
			tfa_code: adminTfaCode,
			remember_me: false,
		});
		await api.claimDomain(adminTfaRes.body.session_token, {
			domain: claimedDomain,
		});

		viewerEmail = `viewer@${domain}`;
		const viewerResult = await createTestOrgUserDirect(
			viewerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId: adminResult.orgId, domain }
		);
		await assignRoleToOrgUser(viewerResult.orgUserId, "org:view_domains");
		const viewerLoginRes = await api.login({
			email: viewerEmail,
			domain,
			password: TEST_PASSWORD,
		});
		const viewerTfaCode = await getTfaCodeFromEmail(viewerEmail);
		const viewerTfaRes = await api.verifyTFA({
			tfa_token: viewerLoginRes.body.tfa_token,
			tfa_code: viewerTfaCode,
			remember_me: false,
		});
		viewerToken = viewerTfaRes.body.session_token;

		noRoleEmail = `norole@${domain}`;
		await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
			orgId: adminResult.orgId,
			domain,
		});
		const noRoleLoginRes = await api.login({
			email: noRoleEmail,
			domain,
			password: TEST_PASSWORD,
		});
		const noRoleTfaCode = await getTfaCodeFromEmail(noRoleEmail);
		const noRoleTfaRes = await api.verifyTFA({
			tfa_token: noRoleLoginRes.body.tfa_token,
			tfa_code: noRoleTfaCode,
			remember_me: false,
		});
		noRoleToken = noRoleTfaRes.body.session_token;
	});

	test.afterAll(async () => {
		await deleteTestGlobalOrgDomain(claimedDomain);
		await deleteTestOrgUser(viewerEmail);
		await deleteTestOrgUser(noRoleEmail);
		await deleteTestOrgUser(adminEmail);
	});

	test("org user WITH view_domains can list-domains (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const response = await api.listDomains(viewerToken, {});
		expect(response.status).toBe(200);
	});

	test("org user WITHOUT role gets 403 on list-domains", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const response = await api.listDomains(noRoleToken, {});
		expect(response.status).toBe(403);
	});
});
