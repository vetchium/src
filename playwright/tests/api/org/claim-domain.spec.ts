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
import type { ClaimDomainRequest } from "vetchium-specs/orgdomains/orgdomains";

/**
 * Helper to create an org user and return the session token.
 */
async function createOrgUserAndGetSession(
	api: OrgAPIClient,
	domainName: string
): Promise<{ email: string; sessionToken: string }> {
	const userEmail = `claim-${Date.now()}@${domainName}`;

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

test.describe("POST /org/claim-domain", () => {
	test("successful domain claim returns verification token", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("claim-test");
		const adminEmail = generateTestEmail("claim-test-admin");

		// Create admin user and approved domain
		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		let userEmail = "";
		const claimedDomain = generateTestDomainName("claimed");

		try {
			// Create org user
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				domainName
			);
			userEmail = email;

			// Claim a new domain
			const claimRequest: ClaimDomainRequest = {
				domain: claimedDomain,
			};
			const response = await api.claimDomain(sessionToken, claimRequest);

			expect(response.status).toBe(201);
			expect(response.body.domain).toBe(claimedDomain.toLowerCase());
			expect(response.body.verification_token).toBeDefined();
			expect(response.body.verification_token).toMatch(/^[a-f0-9]{64}$/);
			expect(response.body.expires_at).toBeDefined();
			expect(response.body.instructions).toBeDefined();
		} finally {
			// Cleanup
			await deleteTestGlobalEmployerDomain(claimedDomain);
			if (userEmail) await deleteTestOrgUser(userEmail);
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const claimRequest: ClaimDomainRequest = {
			domain: "example.com",
		};
		const response = await api.claimDomainWithoutAuth(claimRequest);

		expect(response.status).toBe(401);
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const claimRequest: ClaimDomainRequest = {
			domain: "example.com",
		};
		const response = await api.claimDomain(
			"ind1-" + "a".repeat(64), // Invalid token
			claimRequest
		);

		expect(response.status).toBe(401);
	});

	test("missing domain returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("missing-domain");
		const adminEmail = generateTestEmail("missing-domain-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				domainName
			);
			userEmail = email;

			const response = await api.claimDomainRaw(sessionToken, {});

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("empty domain returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("empty-domain");
		const adminEmail = generateTestEmail("empty-domain-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				domainName
			);
			userEmail = email;

			const response = await api.claimDomainRaw(sessionToken, { domain: "" });

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("invalid domain format returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("invalid-format");
		const adminEmail = generateTestEmail("invalid-format-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				domainName
			);
			userEmail = email;

			const response = await api.claimDomainRaw(sessionToken, {
				domain: "not-a-valid-domain",
			});

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("duplicate domain claim returns 409", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("dup-claim");
		const adminEmail = generateTestEmail("dup-claim-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		let userEmail = "";
		const claimedDomain = generateTestDomainName("dup-claimed");

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				domainName
			);
			userEmail = email;

			// First claim
			const claimRequest: ClaimDomainRequest = {
				domain: claimedDomain,
			};
			const response1 = await api.claimDomain(sessionToken, claimRequest);
			expect(response1.status).toBe(201);

			// Second claim of same domain
			const response2 = await api.claimDomain(sessionToken, claimRequest);
			expect(response2.status).toBe(409);
		} finally {
			await deleteTestGlobalEmployerDomain(claimedDomain);
			if (userEmail) await deleteTestOrgUser(userEmail);
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});
});
