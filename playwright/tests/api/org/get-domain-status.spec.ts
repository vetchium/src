import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	createTestApprovedDomain,
	permanentlyDeleteTestApprovedDomain,
	generateTestEmail,
	generateTestDomainName,
	deleteTestOrgUser,
	deleteTestGlobalEmployerDomain,
} from "../../../lib/db";
import { waitForEmail, getEmailContent } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgInitSignupRequest,
	OrgCompleteSignupRequest,
} from "vetchium-specs/org/org-users";
import type {
	ClaimDomainRequest,
	GetDomainStatusRequest,
} from "vetchium-specs/orgdomains/orgdomains";

/**
 * Helper to create an org user and return the session token.
 */
async function createOrgUserAndGetSession(
	api: OrgAPIClient,
	domainName: string
): Promise<{ email: string; sessionToken: string }> {
	const userEmail = `status-${Date.now()}@${domainName}`;

	// Init signup
	const initRequest: OrgInitSignupRequest = {
		email: userEmail,
	};
	const initResponse = await api.initSignup(initRequest);
	expect(initResponse.status).toBe(200);

	// Wait for email and extract token
	const emailMessage = await waitForEmail(userEmail);
	const fullEmail = await getEmailContent(emailMessage.ID);
	const tokenMatch = fullEmail.HTML.match(/token=([a-f0-9]{64})/);
	expect(tokenMatch).toBeDefined();
	const signupToken = tokenMatch![1];

	// Complete signup
	const completeRequest: OrgCompleteSignupRequest = {
		signup_token: signupToken,
		password: TEST_PASSWORD,
	};
	const completeResponse = await api.completeSignup(completeRequest);
	expect(completeResponse.status).toBe(201);

	return {
		email: userEmail,
		sessionToken: completeResponse.body.session_token,
	};
}

test.describe("POST /org/get-domain-status", () => {
	test("get status of pending domain returns correct info", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("status-test");
		const adminEmail = generateTestEmail("status-test-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		let userEmail = "";
		const claimedDomain = generateTestDomainName("status-claimed");

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				domainName
			);
			userEmail = email;

			// Claim domain first
			const claimRequest: ClaimDomainRequest = {
				domain: claimedDomain,
			};
			const claimResponse = await api.claimDomain(sessionToken, claimRequest);
			expect(claimResponse.status).toBe(201);
			const verificationToken = claimResponse.body.verification_token;

			// Get status
			const statusRequest: GetDomainStatusRequest = {
				domain: claimedDomain,
			};
			const response = await api.getDomainStatus(sessionToken, statusRequest);

			expect(response.status).toBe(200);
			expect(response.body.domain).toBe(claimedDomain.toLowerCase());
			expect(response.body.status).toBe("PENDING");
			expect(response.body.verification_token).toBe(verificationToken);
			expect(response.body.expires_at).toBeDefined();
		} finally {
			await deleteTestGlobalEmployerDomain(claimedDomain);
			if (userEmail) await deleteTestOrgUser(userEmail);
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const statusRequest: GetDomainStatusRequest = {
			domain: "example.com",
		};
		const response = await api.getDomainStatusWithoutAuth(statusRequest);

		expect(response.status).toBe(401);
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const statusRequest: GetDomainStatusRequest = {
			domain: "example.com",
		};
		const response = await api.getDomainStatus(
			"ind1-" + "a".repeat(64), // Invalid token
			statusRequest
		);

		expect(response.status).toBe(401);
	});

	test("missing domain returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("status-missing");
		const adminEmail = generateTestEmail("status-missing-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				domainName
			);
			userEmail = email;

			const response = await api.getDomainStatusRaw(sessionToken, {});

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("empty domain returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("status-empty");
		const adminEmail = generateTestEmail("status-empty-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				domainName
			);
			userEmail = email;

			const response = await api.getDomainStatusRaw(sessionToken, {
				domain: "",
			});

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("unclaimed domain returns 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("status-unclaimed");
		const adminEmail = generateTestEmail("status-unclaimed-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				domainName
			);
			userEmail = email;

			// Get status of a domain that was never claimed
			const statusRequest: GetDomainStatusRequest = {
				domain: "unclaimed-" + Date.now() + ".example.com",
			};
			const response = await api.getDomainStatus(sessionToken, statusRequest);

			expect(response.status).toBe(404);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("domain owned by another employer returns 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domainName1 = generateTestDomainName("status-owner1");
		const domainName2 = generateTestDomainName("status-owner2");
		const adminEmail = generateTestEmail("status-owner-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName1, adminEmail);
		await createTestApprovedDomain(domainName2, adminEmail);

		let userEmail1 = "";
		let userEmail2 = "";
		const claimedDomain = generateTestDomainName("status-owned");

		try {
			// First user claims the domain
			const { email: email1, sessionToken: token1 } =
				await createOrgUserAndGetSession(api, domainName1);
			userEmail1 = email1;

			const claimRequest: ClaimDomainRequest = {
				domain: claimedDomain,
			};
			const claimResponse = await api.claimDomain(token1, claimRequest);
			expect(claimResponse.status).toBe(201);

			// Second user tries to get status of the domain (should fail)
			const { email: email2, sessionToken: token2 } =
				await createOrgUserAndGetSession(api, domainName2);
			userEmail2 = email2;

			const statusRequest: GetDomainStatusRequest = {
				domain: claimedDomain,
			};
			const response = await api.getDomainStatus(token2, statusRequest);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestGlobalEmployerDomain(claimedDomain);
			if (userEmail1) await deleteTestOrgUser(userEmail1);
			if (userEmail2) await deleteTestOrgUser(userEmail2);
			await permanentlyDeleteTestApprovedDomain(domainName1);
			await permanentlyDeleteTestApprovedDomain(domainName2);
			await deleteTestAdminUser(adminEmail);
		}
	});
});
