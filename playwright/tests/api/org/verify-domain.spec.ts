import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	generateTestOrgEmail,
	deleteTestOrgUser,
	deleteTestGlobalEmployerDomain,
	createTestOrgUserDirect,
	generateTestDomainName,
} from "../../../lib/db";
import { getTfaCodeFromEmail, deleteEmailsFor } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type {
	ClaimDomainRequest,
	VerifyDomainRequest,
} from "vetchium-specs/orgdomains/orgdomains";

/**
 * Helper to create an org user directly in DB and return the session token via login.
 */
async function createOrgUserAndGetSession(
	api: OrgAPIClient,
	emailPrefix: string
): Promise<{ email: string; sessionToken: string }> {
	const { email, domain } = generateTestOrgEmail(emailPrefix);

	// Create test org user directly in the database
	await createTestOrgUserDirect(email, TEST_PASSWORD);

	// Clear any existing emails for this address
	await deleteEmailsFor(email);

	// Login to get TFA token
	const loginRequest: OrgLoginRequest = {
		email,
		domain,
		password: TEST_PASSWORD,
	};
	const loginResponse = await api.login(loginRequest);
	expect(loginResponse.status).toBe(200);
	expect(loginResponse.body.tfa_token).toBeDefined();

	// Get TFA code from email and verify
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaRequest: OrgTFARequest = {
		tfa_token: loginResponse.body.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	};
	const tfaResponse = await api.verifyTFA(tfaRequest);
	expect(tfaResponse.status).toBe(200);
	expect(tfaResponse.body.session_token).toBeDefined();

	return { email, sessionToken: tfaResponse.body.session_token };
}

test.describe("POST /org/verify-domain", () => {
	test("verify pending domain without DNS record returns PENDING", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		let userEmail = "";
		const claimedDomain = generateTestDomainName("to-verify");

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"verify-success"
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
		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"verify-missing-domain"
			);
			userEmail = email;

			const response = await api.verifyDomainRaw(sessionToken, {});

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("empty domain returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"verify-empty-domain"
			);
			userEmail = email;

			const response = await api.verifyDomainRaw(sessionToken, { domain: "" });

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("unclaimed domain returns 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"verify-unclaimed"
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
		}
	});

	test("domain owned by another employer returns 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		let userEmail1 = "";
		let userEmail2 = "";
		const claimedDomain = generateTestDomainName("owned");

		try {
			// First user claims the domain
			const { email: email1, sessionToken: token1 } =
				await createOrgUserAndGetSession(api, "verify-owner1");
			userEmail1 = email1;

			const claimRequest: ClaimDomainRequest = {
				domain: claimedDomain,
			};
			const claimResponse = await api.claimDomain(token1, claimRequest);
			expect(claimResponse.status).toBe(201);

			// Second user tries to verify the domain (should fail)
			const { email: email2, sessionToken: token2 } =
				await createOrgUserAndGetSession(api, "verify-owner2");
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
		}
	});
});
