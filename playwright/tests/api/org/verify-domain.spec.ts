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
	VerifyDomainRequest,
} from "vetchium-specs/orgdomains/orgdomains";

/**
 * Helper to create an org user and return the session token.
 */
async function createOrgUserAndGetSession(
	api: OrgAPIClient,
	domainName: string
): Promise<{ email: string; sessionToken: string }> {
	const userEmail = `verify-${Date.now()}@${domainName}`;

	// Init signup
	const initRequest: OrgInitSignupRequest = {
		email: userEmail,
		home_region: "ind1",
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

test.describe("POST /org/verify-domain", () => {
	test("verify pending domain without DNS record returns PENDING", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("verify-test");
		const adminEmail = generateTestEmail("verify-test-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		let userEmail = "";
		const claimedDomain = generateTestDomainName("to-verify");

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

			// Try to verify - should fail since no DNS record exists
			const verifyRequest: VerifyDomainRequest = {
				domain: claimedDomain,
			};
			const response = await api.verifyDomain(sessionToken, verifyRequest);

			// Should return status indicating verification failed
			expect(response.status).toBe(200);
			expect(response.body.status).toBe("PENDING");
		} finally {
			await deleteTestGlobalEmployerDomain(claimedDomain);
			if (userEmail) await deleteTestOrgUser(userEmail);
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const verifyRequest: VerifyDomainRequest = {
			domain: "example.com",
		};
		const response = await api.verifyDomainWithoutAuth(verifyRequest);

		expect(response.status).toBe(401);
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const verifyRequest: VerifyDomainRequest = {
			domain: "example.com",
		};
		const response = await api.verifyDomain(
			"ind1-" + "a".repeat(64), // Invalid token
			verifyRequest
		);

		expect(response.status).toBe(401);
	});

	test("missing domain returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("verify-missing");
		const adminEmail = generateTestEmail("verify-missing-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				domainName
			);
			userEmail = email;

			const response = await api.verifyDomainRaw(sessionToken, {});

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("empty domain returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("verify-empty");
		const adminEmail = generateTestEmail("verify-empty-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				domainName
			);
			userEmail = email;

			const response = await api.verifyDomainRaw(sessionToken, { domain: "" });

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("unclaimed domain returns 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("verify-unclaimed");
		const adminEmail = generateTestEmail("verify-unclaimed-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				domainName
			);
			userEmail = email;

			// Try to verify a domain that was never claimed
			const verifyRequest: VerifyDomainRequest = {
				domain: "unclaimed-" + Date.now() + ".example.com",
			};
			const response = await api.verifyDomain(sessionToken, verifyRequest);

			expect(response.status).toBe(404);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("domain owned by another employer returns 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domainName1 = generateTestDomainName("verify-owner1");
		const domainName2 = generateTestDomainName("verify-owner2");
		const adminEmail = generateTestEmail("verify-owner-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName1, adminEmail);
		await createTestApprovedDomain(domainName2, adminEmail);

		let userEmail1 = "";
		let userEmail2 = "";
		const claimedDomain = generateTestDomainName("owned");

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

			// Second user tries to verify the domain (should fail)
			const { email: email2, sessionToken: token2 } =
				await createOrgUserAndGetSession(api, domainName2);
			userEmail2 = email2;

			const verifyRequest: VerifyDomainRequest = {
				domain: claimedDomain,
			};
			const response = await api.verifyDomain(token2, verifyRequest);

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
