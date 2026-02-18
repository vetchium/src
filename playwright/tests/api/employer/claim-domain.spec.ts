import { test, expect } from "@playwright/test";
import { EmployerAPIClient } from "../../../lib/employer-api-client";
import {
	generateTestOrgEmail,
	deleteTestOrgUser,
	deleteTestGlobalEmployerDomain,
	createTestOrgUserDirect,
	createTestOrgAdminDirect,
	generateTestDomainName,
} from "../../../lib/db";
import { getTfaCodeFromEmail, deleteEmailsFor } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/employer/employer-users";
import type { ClaimDomainRequest } from "vetchium-specs/employer-domains/employer-domains";

/**
 * Helper to create an org user directly in DB and return the session token via login.
 */
async function createOrgUserAndGetSession(
	api: EmployerAPIClient,
	emailPrefix: string
): Promise<{ email: string; sessionToken: string }> {
	const { email, domain } = generateTestOrgEmail(emailPrefix);

	// Create test org user directly in the database
	await createTestOrgAdminDirect(email, TEST_PASSWORD);

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

test.describe("POST /employer/claim-domain", () => {
	test("successful domain claim returns verification token", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		let userEmail = "";
		const claimedDomain = generateTestDomainName("claimed");

		try {
			// Create org user directly in DB and get session via login
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"claim-success"
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
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const claimRequest: ClaimDomainRequest = {
			domain: "example.com",
		};
		const response = await api.claimDomainWithoutAuth(claimRequest);

		expect(response.status).toBe(401);
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new EmployerAPIClient(request);

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
		const api = new EmployerAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"claim-missing-domain"
			);
			userEmail = email;

			const response = await api.claimDomainRaw(sessionToken, {});

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("empty domain returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"claim-empty-domain"
			);
			userEmail = email;

			const response = await api.claimDomainRaw(sessionToken, { domain: "" });

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("invalid domain format returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"claim-invalid-format"
			);
			userEmail = email;

			const response = await api.claimDomainRaw(sessionToken, {
				domain: "not-a-valid-domain",
			});

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("duplicate domain claim returns 409", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		let userEmail = "";
		const claimedDomain = generateTestDomainName("dup-claimed");

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"claim-duplicate"
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
		}
	});
});
