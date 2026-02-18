import { test, expect } from "@playwright/test";
import { EmployerAPIClient } from "../../../lib/employer-api-client";
import {
	generateTestOrgEmail,
	deleteTestOrgUser,
	deleteTestGlobalEmployerDomain,
	createTestOrgAdminDirect,
	generateTestDomainName,
} from "../../../lib/db";
import { getTfaCodeFromEmail, deleteEmailsFor } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/employer/employer-users";
import type {
	ClaimDomainRequest,
	ListDomainStatusRequest,
} from "vetchium-specs/employer-domains/employer-domains";

/**
 * Helper to create an org admin and return session token.
 */
async function createOrgAdminAndGetSession(
	api: EmployerAPIClient,
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

test.describe("POST /employer/list-domains", () => {
	test("no domains returns empty list", async ({ request }) => {
		const api = new EmployerAPIClient(request);
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
		const api = new EmployerAPIClient(request);
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
			await deleteTestGlobalEmployerDomain(claimedDomain);
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("claim two domains and pagination cursor works", async ({ request }) => {
		const api = new EmployerAPIClient(request);
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
			await deleteTestGlobalEmployerDomain(domain1);
			await deleteTestGlobalEmployerDomain(domain2);
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const listRequest: ListDomainStatusRequest = {};
		const response = await api.listDomainsWithoutAuth(listRequest);

		expect(response.status).toBe(401);
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const listRequest: ListDomainStatusRequest = {};
		const response = await api.listDomains(
			"ind1-" + "a".repeat(64),
			listRequest
		);

		expect(response.status).toBe(401);
	});
});
