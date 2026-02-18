import { test, expect } from "@playwright/test";
import { EmployerAPIClient } from "../../../lib/employer-api-client";
import {
	generateTestOrgEmail,
	deleteTestOrgUser,
	createTestOrgUserDirect,
} from "../../../lib/db";
import { getTfaCodeFromEmail, deleteEmailsFor } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/employer/employer-users";

/**
 * Helper function to create a test org user, log them in, and complete TFA.
 * Returns the email and session token for use in logout tests.
 */
async function createOrgUserAndGetSession(
	api: EmployerAPIClient,
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

test.describe("POST /employer/logout", () => {
	test("successful logout returns 200", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email, sessionToken } = await createOrgUserAndGetSession(
			api,
			"org-logout-success"
		);

		try {
			const response = await api.logout(sessionToken);

			expect(response.status).toBe(200);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("logout invalidates session token", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email, sessionToken } = await createOrgUserAndGetSession(
			api,
			"org-logout-invalid"
		);

		try {
			// First logout should succeed
			const response1 = await api.logout(sessionToken);
			expect(response1.status).toBe(200);

			// Second logout with same token should fail (token invalidated)
			const response2 = await api.logout(sessionToken);
			expect(response2.status).toBe(401);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("logout without Authorization header returns 401", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);

		const response = await api.logoutWithoutAuth();

		expect(response.status).toBe(401);
	});

	test("logout with invalid session token returns 401", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		// Use a fake session token with region prefix
		const fakeToken = "ind1:" + "a".repeat(64);
		const response = await api.logout(fakeToken);

		expect(response.status).toBe(401);
	});

	test("logout with malformed session token returns 401", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);

		// Use a malformed token without proper region prefix
		const response = await api.logout("invalid-token");

		expect(response.status).toBe(401);
	});
});
